#! /usr/bin/env node

const Request = require('request');
const _ = require('lodash/fp');
const minimist = require('minimist');
const Promise = require('bluebird');

const updateTravis = require('./travis');
const updatePackage = require('./package');
const updateNvmrc = require('./nvmrc');
const updateDockerfile = require('./dockerfile');
const {commitFiles, pushFiles} = require('./git');
const {createPullRequest, assignReviewers} = require('./github');
const {install, installDev} = require('./yarn');

const request = Promise.promisify(Request, {multiArgs: true});

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const NODE_VERSIONS = 'https://nodejs.org/dist/index.json';

const versionsP = request({uri: NODE_VERSIONS, json: true}).then(([response, body]) => {
  if (response.statusCode !== 200) throw new Error();
  return _.head(body);
});

const nodeP = versionsP.get('version').then(_.trimCharsStart('v'));
const npmP = versionsP.get('npm');

const syncGithub = (
  repoSlug,
  head,
  base,
  message = 'Upgrade NodeJS',
  {team_reviewers = [], reviewers = []} = {},
  githubToken
) => {
  if (!head) return Promise.resolve();

  return commitFiles(message).then(
    () =>
      // eslint-disable-next-line promise/no-nesting
      pushFiles(head, message, githubToken, repoSlug)
        .then(() => createPullRequest(repoSlug, head, base, message, githubToken))
        .then(pullRequest =>
          assignReviewers({team_reviewers, reviewers}, pullRequest, githubToken)
        ),
    () => Promise.resolve()
  );
};

if (!module.parent) {
  const argv = minimist(process.argv);

  Promise.all([
    Promise.all([nodeP, parseArgvToArray(argv.travis)]).spread(updateTravis),
    Promise.all([nodeP, npmP, parseArgvToArray(argv.package)]).spread(updatePackage),
    Promise.all([nodeP, parseArgvToArray(argv.nvmrc)]).spread(updateNvmrc),
    Promise.all([nodeP, parseArgvToArray(argv.dockerfile)]).spread(updateDockerfile),
    install(parseArgvToArray(argv.dependencies)).then(() =>
      installDev(parseArgvToArray(argv.dev_dependencies))
    )
  ])
    .then(() => {
      process.stdout.write('Success\n');

      if (!argv.branch || !argv.base) return Promise.resolve();
      // eslint-disable-next-line promise/no-nesting
      return syncGithub(
        argv.repo_slug,
        argv.branch,
        argv.base,
        argv.message,
        {
          reviewers: parseArgvToArray(argv.reviewers),
          team_reviewers: parseArgvToArray(argv.team_reviewers)
        },
        argv.github_token
      );
    })
    .catch(err => {
      process.stdout.write(`${err.stack}\n`);
      return process.exit(1); // eslint-disable-line unicorn/no-process-exit
    });
}
