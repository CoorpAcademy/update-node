#! /usr/bin/env node

const c = require('chalk').default;
const stripAnsi = require('strip-ansi').default;
const _ = require('lodash/fp');
const pMap = require('p-map').default;
const semver = require('semver');
const updateNvmrc = require('./updatees/nvmrc');
const updateTravis = require('./updatees/travis');
const updateServerless = require('./updatees/serverless');
const {
  updateLock,
  updateDependencies,
  updateDevDependencies,
  updatePackageEngines,
  updateLearnaPackageEngines,
  listLernaPackageFiles,
  readPackage
} = require('./updatees/package');
const updateDockerfile = require('./updatees/dockerfile');
const {commitFiles, currentUser} = require('./core/git');
const {getNodeVersionRunner} = require('./core/node-version-manager');
const {syncGithub, publishGithub} = require('./core/github');
const {findLatest, findSupportedVersions, isLowerBoundRange} = require('./core/node');
const {nodeUpgradeBase, onNodeBranch} = require('./core/node-branches');
const {
  createNodeUpgradeTarget,
  nodeUpgradeBranch,
  nodeUpgradeMarker,
  closeSupersededNodePullRequests
} = require('./core/node-pull-requests');
const {makeError, formatEventualSuffix} = require('./core/utils');

const prepareNodeUpgrade = async (latestNode, config, {multipleVersions = false} = {}) => {
  process.stdout.write(c.bold.blue(`\n\n⬆️  About to bump node version:\n`));
  const exact = config.exact ?? config.node.exact ?? false;
  const loose = config.loose ?? config.node.loose ?? true;
  const preserveSameMajor = config.node.preserveSameMajor ?? multipleVersions;
  const engineOptions = {exact, loose, preserveSameMajor};
  const {scope, preCommitBumpCommand, syncLock} = config.argv;
  const commands = _.compact([
    syncLock &&
      (config.packageManager === 'npm' ? 'npm install' : 'yarn --ignore-engines --ignore-scripts'),
    ...(preCommitBumpCommand || [])
  ]);
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  const runNodeCommands = _.isEmpty(commands)
    ? null
    : await getNodeVersionRunner(multipleVersions ? nodeVersion : undefined);
  // Let every write finish before a failed candidate restores the working tree.
  const updates = await Promise.allSettled([
    updateServerless(nodeVersion, config.node.serverless),
    updateTravis(nodeVersion, config.node.travis),
    updatePackageEngines(nodeVersion, latestNode.npm, config.node.package, engineOptions),
    updateNvmrc(nodeVersion, config.node.nvmrc),
    updateDockerfile(nodeVersion, config.node.dockerfile),
    config.lernaMonorepo && updateLearnaPackageEngines(nodeVersion, latestNode.npm, engineOptions)
  ]);
  const failure = updates.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  if (runNodeCommands) await runNodeCommands(commands);

  const messageSuffix = formatEventualSuffix(config.argv.message);

  process.stdout.write(`+ Successfully bumped Node version to v${c.bold.blue(nodeVersion)}\n`);
  return {
    branch: _.compact(['update-node', config.argv.scope, `v${nodeVersion}`]).join('-'),
    message: `Upgrade Node to v${nodeVersion}${messageSuffix} ${scope ? ` on scope ${scope}` : ''}`,
    pullRequest: {
      title: `${scope ? `[${scope}] ` : ''}Upgrade Node to v${nodeVersion}`,
      body: `:rocket: Upgraded Node version to v${nodeVersion}${messageSuffix}${scope ? ` on scope ${scope}` : ''}`
    }
  };
};

const bumpNodeVersion = async (version, config, base) => {
  const target = createNodeUpgradeTarget(
    version.version,
    config.argv.scope || '',
    config.node.branch || 'update-node'
  );
  const branch = nodeUpgradeBranch(target);
  try {
    const details = await onNodeBranch(branch, base, async () => {
      const packages = _.compact([
        config.package,
        ..._.castArray(config.node.package || []),
        ...(config.lernaMonorepo ? await listLernaPackageFiles() : [])
      ]);
      const contents = await Promise.all([...new Set(packages)].map(readPackage));
      const incompatible = contents.some(pkg => {
        const engineRange = _.get('engines.node', pkg);
        const minimum = engineRange && semver.minVersion(engineRange);
        return minimum && semver.lt(version.version, minimum);
      });
      if (incompatible) {
        process.stdout.write(`- Skipping ${branch}: a package requires a newer Node release.\n`);
        return null;
      }
      const nodeUpgrade = await prepareNodeUpgrade(version, config, {multipleVersions: true});
      return {
        ...nodeUpgrade,
        branch,
        pullRequest: {
          ...nodeUpgrade.pullRequest,
          body: `${nodeUpgrade.pullRequest.body}\n\n${nodeUpgradeMarker(target)}`
        }
      };
    });
    if (!details.commit) {
      process.stdout.write(`- No changes for ${branch}.\n`);
      return null;
    }
    if (config.local) {
      process.stdout.write(`+ Prepared local branch ${branch} at ${details.commit}.\n`);
      return null;
    }
    const status = await publishGithub(config, {
      ...details,
      pullRequest: {
        ...details.pullRequest,
        label: config.label,
        reviewers: _.pull(await currentUser(), config.reviewers),
        team_reviewers: config.teamReviewers
      }
    });
    await closeSupersededNodePullRequests(config, status.pullRequest, target);
    process.stdout.write(`+ Prepared ${branch}: ${status.pullRequest.html_url}\n`);
    return null;
  } catch (error) {
    process.stdout.write(`- Failed ${branch}: ${error.message}\n`);
    return {branch, error};
  }
};

const bumpDependenciesCluster = async (pkg, cluster, config) => {
  process.stdout.write(
    c.bold.blue(`\n\n⬆️  About to bump depencies cluster ${c.bold.white(cluster.name)}:\n`)
  );
  const installedDependencies = await updateDependencies(pkg, cluster.dependencies);
  const installedDevDependencies = await updateDevDependencies(pkg, cluster.devDependencies);
  const allInstalledDependencies = [...installedDependencies, ...installedDevDependencies];
  if (_.isEmpty(allInstalledDependencies)) {
    process.stdout.write('+ No dependencies to update were found');
    return {};
  }
  const messageSuffix = formatEventualSuffix(config.argv.message);
  const dependenciesBumpDescription = allInstalledDependencies
    .map(
      ([dep, oldVersion, newVersion]) =>
        `  - ${c.bold(dep)}: ${c.dim(oldVersion)} -> ${c.blue.bold(newVersion)}`
    )
    .join('\n');

  process.stdout.write(
    `+ Successfully updated ${
      allInstalledDependencies.length
    } dependencies of cluster ${c.bold.blue(cluster.name)}:\n${dependenciesBumpDescription}\n`
  );
  const title = cluster.message || 'Upgrade dependencies';
  const coreMessage = `Upgraded dependencies:\n${stripAnsi(dependenciesBumpDescription)}\n`;

  return {
    branch: cluster.branch || `update-dependencies-${cluster.name}`,
    message: `${title}\n\n${coreMessage}${messageSuffix}`,
    pullRequest: {
      title,
      body: `### :outbox_tray: ${coreMessage}${messageSuffix}`
    }
  };
};

const commitAndMakePullRequest = config => async options => {
  const {branch, message, pullRequest} = options;

  if (!config.baseBranch) throw makeError('No base branch is defined');
  if (config.local) {
    return commitFiles(null, message, config.baseBranch);
  }
  const status = await syncGithub(
    config.repoSlug,
    config.baseBranch,
    branch,
    message,
    {
      body: _.get('body', pullRequest),
      title: _.get('title', pullRequest),
      label: config.label,
      reviewers: _.pull(await currentUser(), config.reviewers),
      team_reviewers: config.teamReviewers
    },
    config.token,
    config.forceFlag,
    config.baseBranch
  );
  if (!status.commit)
    process.stdout.write('+ Did not made a Pull request, nothing has changed 😴\n');
  else if (status.pullRequest) {
    process.stdout.write(
      `+ Successfully handled pull request ${c.bold.blue(`(#${status.pullRequest.number})`)}
  - 📎  ${c.bold.cyan(status.pullRequest.html_url)}
  - 🔖  ${c.bold.dim(status.commit)}
  - 🌳  ${c.bold.green(status.branch)}\n`
    );
  } else {
    process.stdout.write(
      `+ Some issue seems to have occured with publication of changes ${status.commit}\n`
    );
  }
  return status;
};

module.exports = async (
  config,
  {nodeVersionOverride, onlyNodeVersion = false, ignoreDependencies = false} = {}
) => {
  const _commitAndMakePullRequest = commitAndMakePullRequest(config);
  const clusters = config.dependencies;

  const RANGE =
    nodeVersionOverride ||
    config.node_range ||
    _.getOr('^18', 'packageContent.engines.node', config);
  const nodeErrors = [];
  if (config.node) {
    if (nodeVersionOverride || !isLowerBoundRange(config.packageContent?.engines?.node || '')) {
      const latestNode = await findLatest(RANGE);
      if (!latestNode) throw makeError(`No available Node release matches ${RANGE}`);
      const bumpCommitConfig = await prepareNodeUpgrade(latestNode, config);
      await _commitAndMakePullRequest(bumpCommitConfig);
    } else {
      const versions = await findSupportedVersions(RANGE);
      if (versions.length === 0) {
        process.stdout.write('- No supported even Node releases match this range.\n');
      } else {
        const base = nodeUpgradeBase(config.baseBranch);
        const results = await pMap(versions, version => bumpNodeVersion(version, config, base), {
          concurrency: 1
        });
        nodeErrors.push(..._.compact(results));
      }
    }
  }
  if (onlyNodeVersion || ignoreDependencies) {
    if (nodeErrors.length > 0)
      throw makeError(
        `Node upgrades failed: ${nodeErrors.map(result => result.branch).join(', ')}`
      );
    return process.stdout.write(c.bold.green('\n\nUpdate-node bumped node with success 📤\n'));
  }

  const clusterDetails = await pMap(
    clusters,
    async cluster => {
      const branchDetails = await bumpDependenciesCluster(config.package, cluster, config);
      if (!branchDetails.branch) return {};
      await updateLock(config.packageManager);
      const {branch, commit, pullRequest, error} = await _commitAndMakePullRequest(branchDetails);
      return {branchDetails, pullRequest, branch, commit, error};
    },
    {concurrency: 1}
  ).catch(err => {
    process.stdout.write(`${err}\n`);
    process.stdout.write(`${err.stack}\n`);
    return process.exit(1);
  });
  _.forEach(clusterDetail => {
    if (clusterDetail.branch)
      process.stdout.write(
        `- ${c.bold.green(clusterDetail.branch)}: ${c.dim.bold(
          clusterDetail.pullRequest.html_url
        )}\n`
      );
  }, clusterDetails);
  if (nodeErrors.length > 0)
    throw makeError(`Node upgrades failed: ${nodeErrors.map(result => result.branch).join(', ')}`);
  process.stdout.write(c.bold.green('\n\nUpdate-node run with success 📤\n'));
  process.stdout.write('\n');
};
