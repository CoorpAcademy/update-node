#! /usr/bin/env node

const Request = require('request');
const _ = require('lodash/fp');
const minimist = require('minimist');
const Promise = require('bluebird');
const updateNvmrc = require('./nvmrc');
const updateTravis = require('./travis');
const updatePackage = require('./package');
const {install, installDev} = require('./yarn');
const updateDockerfile = require('./dockerfile');
const {commitFiles, pushFiles} = require('./git');
const {createPullRequest, assignReviewers} = require('./github');

const request = Promise.promisify(Request, {multiArgs: true});

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const NODE_VERSIONS = 'https://nodejs.org/dist/index.json';

const versionsP = request({uri: NODE_VERSIONS, json: true}).then(([response, body]) => {
  if (response.statusCode !== 200) throw new Error("nodejs.org isn't available");
  return body;
});

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
    () =>
      // eslint-disable-next-line promise/no-nesting
      pushFiles(branch, message, githubToken, repoSlug)
        .then(() => createPullRequest(repoSlug, branch, base, message, githubToken))
        .then(pullRequest =>
          assignReviewers({team_reviewers, reviewers}, pullRequest, githubToken)
        ),
    () => Promise.resolve()
  );
};

const bumpNodeVersion = (latestNode, argv) => {
  const nodeVersion = _.trimCharsStart('v', latestNode.version);
  return Promise.all([
    updateTravis(nodeVersion, parseArgvToArray(argv.travis)),
    updatePackage(nodeVersion, latestNode.npm, parseArgvToArray(argv.package)),
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

const bumpDependencies = argv => {
  return install(parseArgvToArray(argv.dependencies))
    .then(() => installDev(parseArgvToArray(argv.dev_dependencies)))
    .then(() => {
      process.stdout.write(`Successfully updated dependencies`);
      return {
        branch: `update-dependencies`, // TODO Clusterize dependency updates
        message: `Upgrade dependencies`
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

if (!module.parent) {
  const argv = minimist(process.argv);
  const _makePullRequest = makePullRequest(argv);

  const latestNodeP = versionsP.then(_.find(_.pipe(_.get('version'), _.startsWith('v8.'))));

  latestNodeP
    .then(latestNode => bumpNodeVersion(latestNode, argv))
    .then(_makePullRequest)
    .then(() => bumpDependencies(argv))
    .then(_makePullRequest)
    .catch(err => {
      process.stdout.write(`${err.stack}\n`);
      return process.exit(1);
    });
}
