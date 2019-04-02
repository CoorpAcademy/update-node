#! /usr/bin/env node

const fs = require('fs');
const path = require('path');
const _ = require('lodash/fp');
const minimist = require('minimist');
const Promise = require('bluebird');
const findUp = require('find-up');
const updateNvmrc = require('./updatees/nvmrc');
const updateTravis = require('./updatees/travis');
const {readPackage, updatePackage} = require('./updatees/package');
const {install, installDev} = require('./updatees/yarn');
const updateDockerfile = require('./updatees/dockerfile');
const {syncGithub} = require('./core/github');
const {findLatest} = require('./core/node');

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const resolveConfig = (config, configPath, argv) => {
  const base = _.cloneDeep(config);
  const defaultWithPath = (value, defaulte) => {
    const resolvedValue =
      // eslint-disable-next-line no-nested-ternary
      value === true ? [defaulte] : _.isArray(value) ? value : value && value.split(',') || [];
    return _.map(val => path.join(path.dirname(configPath), val), resolvedValue);
  };

  base.package = path.join(path.dirname(configPath), base.package || 'package.json');
  base.node.nvmrc = defaultWithPath(base.node.nvmrc, '.nvmrc');
  base.node.dockerfile = defaultWithPath(base.node.dockerfile, 'Dockerfile');
  base.node.travis = defaultWithPath(base.node.travis, '.travis.yml');
  base.node.package = defaultWithPath(base.node.package, 'package.json');
  config.local = argv.local;
  config.token = argv.token;
  return base;
};

const bumpNodeVersion = (latestNode, config) => {
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  return Promise.all([
    updateTravis(nodeVersion, config.node.travis),
    updatePackage(nodeVersion, latestNode.npm, config.node.package, !!config.exact),
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

const bumpDependencies = (pkg, cluster) => {
  return install(pkg, cluster.dependencies)
    .then(installedDeps =>
      // eslint-disable-next-line promise/no-nesting
      installDev(pkg, cluster.devDependencies).then(installedDevDeps =>
        installedDeps.concat(installedDevDeps)
      )
    )
    .then(allInstalledDeps => {
      process.stdout.write(
        `Successfully updated ${allInstalledDeps.length} dependencies of cluster ${cluster.name}`
      );
      return {
        branch: cluster.branch || `update-dependencies-${cluster.name}`,
        message: `${cluster.message ||
          'Upgrade dependencies'}\n\nUpgraded dependencies:\n- ${allInstalledDeps.join('\n- ')}`
      };
    });
};

const makePullRequest = config => ({branch, message}) => {
  if (!config.base || config.local) return Promise.resolve();
  return syncGithub(
    config.repo_slug,
    config.base,
    branch,
    message,
    {
      reviewers: parseArgvToArray(config.reviewers),
      team_reviewers: parseArgvToArray(config.team_reviewers)
    },
    config.token
  );
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

  const _makePullRequest = makePullRequest(extendedConfig);
  const clusters = extendedConfig.dependencies;

  const RANGE = argv.node_range || '^8';
  const latestNode = await findLatest(RANGE);

  const {branch, message} = await bumpNodeVersion(latestNode, extendedConfig);
  await _makePullRequest({branch, message});
  const pkg = await readPackage(extendedConfig.package);
  await Promise.mapSeries(
    clusters,
    cluster => bumpDependencies(pkg, cluster).then(_makePullRequest) // eslint-disable-line promise/no-nesting
  ).catch(err => {
    process.stdout.write(`${err.stack}\n`);
    return process.exit(1);
  });
};

if (!module.parent) {
  const argv = minimist(process.argv);
  main(argv);
}
