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

const bumpNodeVersion = (latestNode, argv) => {
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  return Promise.all([
    updateTravis(nodeVersion, parseArgvToArray(argv.travis)),
    updatePackage(nodeVersion, latestNode.npm, parseArgvToArray(argv.package), !!argv.exact),
    updateNvmrc(nodeVersion, parseArgvToArray(argv.nvmrc)),
    updateDockerfile(nodeVersion, parseArgvToArray(argv.dockerfile))
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
      process.stdout.write(`Successfully updated ${allInstalledDeps.length} dependencies`);
      return {
        branch: `update-dependencies-${cluster.name}`,
        message: `Upgrade dependencies\n\nUpgraded dependencies:\n- ${allInstalledDeps.join(
          '\n- '
        )}`
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
  const configFile = argv.config || findUp.sync('.update-node.json');
  if (!configFile) {
    console.error('No .update-node.json was found, neither a --config was given');
    process.exit(12);
  }
  const config = JSON.parse(fs.readFileSync(configFile));
  // FIXME perform schema validation
  config.local = argv.local;
  config.token = argv.token;

  const _makePullRequest = makePullRequest(config);
  const clusters = config.dependencies;

  const RANGE = argv.node_range || '^8';
  const latestNode = await findLatest(RANGE);

  const {branch, message} = await bumpNodeVersion(latestNode, argv);
  await _makePullRequest({branch, message});
  const pkg = await readPackage(path.join(path.dirname(configFile), config.package || 'package.json'));
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
