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
  if (response.statusCode !== 200) throw new Error("nodejs.org isn't available");
  return body;
});

const DOCKER_TAGS = version =>
  `https://hub.docker.com/v2/repositories/library/node/tags/${_.trimCharsStart('v')(version)}/`;

const availableOnDockerHub = ({version, npm}) =>
  request({uri: DOCKER_TAGS(version), json: true}).then(([response, body]) => {
    if (response.statusCode !== 200) throw new Error(`Node's image ${version} isn't available`);
    return body;
  });

const versionP = versionsP
  .then(_.find(_.pipe(_.get('version'), _.startsWith('v8.'))))
  .tap(availableOnDockerHub);

const nodeP = versionP.get('version').then(_.trimCharsStart('v'));
const npmP = versionP.get('npm');

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

const updateNodeNpm = (nodeP, npmP, argv) =>
  Promise.all([nodeP, npmP])
    .catch(err => Promise.resolve([null, null]))
    .then(([node, npm]) => {
      if (!node || !npm) return null;
      return Promise.all([
        updateTravis(node, parseArgvToArray(argv.travis)),
        updatePackage(node, npm, parseArgvToArray(argv.package), !!argv.exact),
        updateNvmrc(node, parseArgvToArray(argv.nvmrc)),
        updateDockerfile(node, parseArgvToArray(argv.dockerfile))
      ]);
    });

if (!module.parent) {
  const argv = minimist(process.argv);

  Promise.all([
    updateNodeNpm(nodeP, npmP, argv),
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
