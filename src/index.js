#! /usr/bin/env node

const fs = require('fs');
const path = require('path');
const c = require('chalk');
const _ = require('lodash/fp');
const minimist = require('minimist');
const Promise = require('bluebird');
const findUp = require('find-up');
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

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const resolveConfig = (config, configPath, argv) => {
  const base = _.cloneDeep(config);
  const defaultWithPath = (value, defaulte) => {
    const resolvedValue =
      // eslint-disable-next-line no-nested-ternary
      value === true ? [defaulte] : _.isArray(value) ? value : (value && value.split(',')) || [];
    return _.map(val => path.join(path.dirname(configPath), val), resolvedValue);
  };

  base.package = path.join(path.dirname(configPath), base.package || 'package.json');
  base.node.nvmrc = defaultWithPath(base.node.nvmrc, '.nvmrc');
  base.node.dockerfile = defaultWithPath(base.node.dockerfile, 'Dockerfile');
  base.node.travis = defaultWithPath(base.node.travis, '.travis.yml');
  base.node.package = defaultWithPath(base.node.package, 'package.json');
  base.local = argv.local;
  base.token = argv.token;
  return base;
};

const bumpNodeVersion = (latestNode, config) => {
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  return Promise.all([
    updateTravis(nodeVersion, config.node.travis),
    updatePackageEngines(nodeVersion, latestNode.npm, config.node.package, !!config.exact),
    updateNvmrc(nodeVersion, config.node.nvmrc),
    updateDockerfile(nodeVersion, config.node.dockerfile)
  ]).then(() => {
    process.stdout.write(`Successfully bumped Node version to v${nodeVersion}\n`);
    return {
      branch: `update-node-v${nodeVersion}`,
      message: `Upgrade Node to v${nodeVersion}`
    };
  });
};

const bumpDependencies = async (pkg, cluster) => {
  process.stdout.write(
    c.bold.blue(`\nAbout to bump depencies cluster ${c.bold.white(cluster.name)}\n`)
  );
  const installedDependencies = await updateDependencies(pkg, cluster.dependencies);
  const installedDevDependencies = await updateDevDependencies(pkg, cluster.devDependencies);
  const allInstalledDependencies = installedDependencies.concat(installedDevDependencies);
  process.stdout.write(
    `+ Successfully updated ${allInstalledDependencies.length} dependencies of cluster ${
      cluster.name
    }:\n${allInstalledDependencies
      .map(
        ([dep, oldVersion, newVersion]) =>
          `  - ${c.bold(dep)}: ${c.dim(oldVersion)} -> ${c.blue.bold(newVersion)}`
      )
      .join('\n')}\n`
  );
  return {
    branch: cluster.branch || `update-dependencies-${cluster.name}`,
    message: `${cluster.message ||
      'Upgrade dependencies'}\n\nUpgraded dependencies:\n${allInstalledDependencies
      .map(([dep, oldVersion, newVersion]) => `- ${dep}: ${oldVersion} -> ${newVersion}`)
      .join('\n')}\n`
  };
};

const commitAndMakePullRequest = config => async ({branch, message}) => {
  if (!config.baseBranch) return Promise.resolve();
  if (config.local) {
    return commitFiles(null, message);
  }
  const status = await syncGithub(
    config.repoSlug,
    config.baseBranch,
    branch,
    message,
    {
      label: config.label,
      reviewers: parseArgvToArray(config.reviewers),
      team_reviewers: parseArgvToArray(config.teamReviewers)
    },
    config.token
  );
  if (!status.commit) process.stdout.write('+ Did not made a Pull request, nothing has changed\n');
  else process.stdout.write('+ Successfulley handled pull request\n');
  // TODO paste uri of PR
  return status;
};

const main = async argv => {
  /* eslint-disable no-console */
  // FIXME drop for yargs
  const configPath = argv.config || findUp.sync('.update-node.json');
  if (!configPath) {
    console.error('No .update-node.json was found, neither a --config was given');
    process.exit(12);
  }
  const config = JSON.parse(fs.readFileSync(configPath));
  // FIXME perform schema validation
  const extendedConfig = resolveConfig(config, configPath, argv);

  const _commitAndMakePullRequest = commitAndMakePullRequest(extendedConfig);
  const clusters = extendedConfig.dependencies;

  const RANGE = argv.node_range || '^8';
  const latestNode = await findLatest(RANGE);

  const {branch, message} = await bumpNodeVersion(latestNode, extendedConfig);
  await _commitAndMakePullRequest({branch, message});
  await Promise.mapSeries(clusters, async cluster => {
    const branchDetails = await bumpDependencies(extendedConfig.package, cluster);
    await updateLock(config.packageManager);
    await _commitAndMakePullRequest(branchDetails);
  }).catch(err => {
    process.stdout.write(`${err}\n`);
    process.stdout.write(`${err.stack}\n`);
    return process.exit(1);
  });
  process.stdout.write(c.bold.green('\n\nUpdate-node run with success 📤\n'));
};

if (!module.parent) {
  const argv = minimist(process.argv);
  main(argv).catch(err => {
    console.error(err);
    process.exit(2);
  });
}
