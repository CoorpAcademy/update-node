#! /usr/bin/env node

const c = require('chalk');
const _ = require('lodash/fp');
const pMap = require('p-map');
const updateNvmrc = require('./updatees/nvmrc');
const updateTravis = require('./updatees/travis');
const updateServerless = require('./updatees/serverless');
const {
  updateLock,
  updateDependencies,
  updateDevDependencies,
  updatePackageEngines,
  updateLearnaPackageEngines
} = require('./updatees/package');
const updateDockerfile = require('./updatees/dockerfile');
const {commitFiles, currentUser} = require('./core/git');
const {executeScript} = require('./core/script');
const {syncGithub} = require('./core/github');
const {findLatest} = require('./core/node');
const {makeError, formatEventualSuffix} = require('./core/utils');

const LOAD_NVM = '. ${NVM_DIR:-$HOME/.nvm}/nvm.sh && (nvm use || nvm install)'; // eslint-disable-line no-template-curly-in-string

const bumpNodeVersion = async (latestNode, config) => {
  process.stdout.write(c.bold.blue(`\n\n⬆️  About to bump node version:\n`));
  const {exact, loose} = config.node;
  const {scope, preCommitBumpCommand, syncLock} = config.argv;
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  await Promise.all([
    updateServerless(nodeVersion, config.node.serverless),
    updateTravis(nodeVersion, config.node.travis),
    updatePackageEngines(nodeVersion, latestNode.npm, config.node.package, {exact, loose}),
    updateNvmrc(nodeVersion, config.node.nvmrc),
    updateDockerfile(nodeVersion, config.node.dockerfile),
    config.lernaMonorepo && updateLearnaPackageEngines(nodeVersion, latestNode.npm, {exact, loose})
  ]);
  // Post commands to synchronise the package-lock.json
  if (syncLock)
    await executeScript([
      LOAD_NVM,
      config.packageManager === 'npm' ? 'npm install' : 'yarn --ignore-engines --ignore-scripts'
    ]);
  if (!_.isEmpty(preCommitBumpCommand)) await executeScript([LOAD_NVM, ...preCommitBumpCommand]);

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
  const coreMessage = `Upgraded dependencies:\n${dependenciesBumpDescription}\n`;

  return {
    branch: cluster.branch || `update-dependencies-${cluster.name}`,
    message: `${title}\n\n${coreMessage}${messageSuffix}`,
    pullRequest: {
      title,
      body: `### :outbox_tray: ${coreMessage}}${messageSuffix}`
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
  const latestNode = await findLatest(RANGE);
  if (config.node) {
    const bumpCommitConfig = await bumpNodeVersion(latestNode, config);
    await _commitAndMakePullRequest(bumpCommitConfig);
  }
  if (onlyNodeVersion || ignoreDependencies) {
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
  process.stdout.write(c.bold.green('\n\nUpdate-node run with success 📤\n'));
  _.forEach(clusterDetail => {
    if (clusterDetail.branch)
      process.stdout.write(
        `- ${c.bold.green(clusterDetail.branch)}: ${c.dim.bold(
          clusterDetail.pullRequest.html_url
        )}\n`
      );
  }, clusterDetails);
  process.stdout.write('\n');
};
