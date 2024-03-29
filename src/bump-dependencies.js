#! /usr/bin/env node

const c = require('chalk');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const updateNvmrc = require('./updatees/nvmrc');
const updateTravis = require('./updatees/travis');
const {
  updateLock,
  updateDependencies,
  updateDevDependencies,
  updatePackageEngines
} = require('./updatees/package');
const updateDockerfile = require('./updatees/dockerfile');
const {commitFiles} = require('./core/git');
const {syncGithub} = require('./core/github');
const {findLatest} = require('./core/node');
const {makeError} = require('./core/utils');

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const bumpNodeVersion = async (latestNode, config) => {
  process.stdout.write(c.bold.blue(`\n\n⬆️  About to bump node version:\n`));
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  await Promise.all([
    updateTravis(nodeVersion, config.node.travis),
    updatePackageEngines(nodeVersion, latestNode.npm, config.node.package, !!config.exact),
    updateNvmrc(nodeVersion, config.node.nvmrc),
    updateDockerfile(nodeVersion, config.node.dockerfile)
  ]);

  process.stdout.write(`+ Successfully bumped Node version to v${c.bold.blue(nodeVersion)}\n`);
  return {
    branch: `update-node-v${nodeVersion}`,
    message: `Upgrade Node to v${nodeVersion}`,
    pullRequest: {
      title: `Upgrade Node to v${nodeVersion}`,
      body: `:rocket: Upgraded Node version to v${nodeVersion}`
    }
  };
};

const bumpDependencies = async (pkg, cluster) => {
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
  process.stdout.write(
    `+ Successfully updated ${
      allInstalledDependencies.length
    } dependencies of cluster ${c.bold.blue(cluster.name)}:\n${allInstalledDependencies
      .map(
        ([dep, oldVersion, newVersion]) =>
          `  - ${c.bold(dep)}: ${c.dim(oldVersion)} -> ${c.blue.bold(newVersion)}`
      )
      .join('\n')}\n`
  );
  return {
    branch: cluster.branch || `update-dependencies-${cluster.name}`,
    message: `${
      cluster.message || 'Upgrade dependencies'
    }\n\nUpgraded dependencies:\n${allInstalledDependencies
      .map(([dep, oldVersion, newVersion]) => `- ${dep} ${oldVersion} -> ${newVersion}`)
      .join('\n')}\n`,
    pullRequest: {
      title: cluster.message || 'Upgrade dependencies',
      body: `### :outbox_tray: Upgraded dependencies:\n${allInstalledDependencies
        .map(
          ([dep, oldVersion, newVersion]) =>
            `- [\`${dep}\`](https://www.npmjs.com/package/${dep}): ${oldVersion} -> ${newVersion}`
        )
        .join('\n')}\n`
    }
  };
};

const commitAndMakePullRequest = config => async options => {
  const {branch, message, pullRequest} = options;

  if (!config.baseBranch) throw makeError('No base branch is defined');
  if (config.local) {
    return commitFiles(null, message);
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
      reviewers: parseArgvToArray(config.reviewers),
      team_reviewers: parseArgvToArray(config.teamReviewers)
    },
    config.token
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

module.exports = async config => {
  const _commitAndMakePullRequest = commitAndMakePullRequest(config);
  const clusters = config.dependencies;

  const RANGE = config.node_range || _.getOr('^8', 'packageContent.engines.node', config);
  const latestNode = await findLatest(RANGE);
  if (config.node) {
    const bumpCommitConfig = await bumpNodeVersion(latestNode, config);
    await _commitAndMakePullRequest(bumpCommitConfig);
  }
  const clusterDetails = await Promise.mapSeries(clusters, async cluster => {
    const branchDetails = await bumpDependencies(config.package, cluster);
    if (!branchDetails.branch) return {};
    await updateLock(config.packageManager);
    const {branch, commit, pullRequest, error} = await _commitAndMakePullRequest(branchDetails);
    return {branchDetails, pullRequest, branch, commit, error};
  }).catch(err => {
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
