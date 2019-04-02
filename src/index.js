#! /usr/bin/env node

const _ = require('lodash/fp');
const minimist = require('minimist');
const Promise = require('bluebird');
const updateNvmrc = require('./updatees/nvmrc');
const updateTravis = require('./updatees/travis');
const {readPackage, updatePackage} = require('./updatees/package');
const {install, installDev} = require('./updatees/yarn');
const updateDockerfile = require('./updatees/dockerfile');
const {commitFiles, pushFiles} = require('./core/git');
const {createPullRequest, assignReviewers} = require('./core/github');
const {findLatest} = require('./core/node');
const dependenciesClusters = require('./dependencies.json');

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const syncGithub = (
  repoSlug,
  base,
  branch,
  message,
  {team_reviewers = [], reviewers = []} = {},
  githubToken
) => {
  if (!branch) return Promise.resolve();

  return commitFiles(branch, message).then(
    branchHasCommits => {
      if (!branchHasCommits) {
        return;
      }

      // eslint-disable-next-line promise/no-nesting
      return pushFiles(branch, message, githubToken, repoSlug)
        .then(() => createPullRequest(repoSlug, branch, base, message, githubToken))
        .then(pullRequest =>
          assignReviewers({team_reviewers, reviewers}, pullRequest, githubToken)
        );
    },
    () => Promise.resolve()
  );
};

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

const bumpDependencies = (blacklistedDependencies, pkg, cluster) => {
  return install(pkg, blacklistedDependencies, cluster.dependencies)
    .then(installedDeps =>
      // eslint-disable-next-line promise/no-nesting
      installDev(pkg, blacklistedDependencies, cluster.devDependencies).then(installedDevDeps =>
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

const makePullRequest = argv => ({branch, message}) => {
  if (!argv.base) return Promise.resolve();
  return syncGithub(
    argv.repo_slug,
    argv.base,
    branch,
    message,
    {
      reviewers: parseArgvToArray(argv.reviewers),
      team_reviewers: parseArgvToArray(argv.team_reviewers)
    },
    argv.github_token
  );
};

const customClusters = argv => {
  if (!argv.dependencies && !argv.dev_dependencies) {
    return [];
  }

  const allCoreDependencies = _.flatMap(
    cluster => cluster.dependencies.concat(cluster.devDependencies),
    dependenciesClusters
  );

  const dependencies = _.without(allCoreDependencies, parseArgvToArray(argv.dependencies));
  const devDependencies = _.without(allCoreDependencies, parseArgvToArray(argv.dev_dependencies));

  return [
    {
      name: 'custom',
      dependencies,
      devDependencies
    }
  ];
};

if (!module.parent) {
  const argv = minimist(process.argv);
  const _makePullRequest = makePullRequest(argv);
  const blacklistedDependencies = parseArgvToArray(argv.blacklist);
  const clusters = dependenciesClusters.concat(customClusters(argv));

  const RANGE = argv.node_range || '^8';
  const versionP = findLatest(RANGE);

  versionP
    .then(latestNode => bumpNodeVersion(latestNode, argv))
    .then(_makePullRequest)
    .then(() => readPackage(argv.package || './package.json'))
    .then(pkg =>
      Promise.mapSeries(
        clusters,
        cluster => bumpDependencies(blacklistedDependencies, pkg, cluster).then(_makePullRequest) // eslint-disable-line promise/no-nesting
      )
    )
    .catch(err => {
      process.stdout.write(`${err.stack}\n`);
      return process.exit(1);
    });
}
