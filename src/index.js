#! /usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');
const Request = require('request');
const _ = require('lodash/fp');
const minimist = require('minimist');
const Promise = require('bluebird');
const yaml = require('js-yaml');
const shelljs = require('shelljs');

const exec = Promise.promisify(shelljs.exec);
const writeFile = Promise.promisify(fs.writeFile);
const readFile = Promise.promisify(fs.readFile);
const request = Promise.promisify(Request, {multiArgs: true});

const parseArgvToArray = _.pipe(_.split(','), _.compact);

const NODE_VERSIONS = 'https://nodejs.org/dist/index.json';

const versionsP = request({uri: NODE_VERSIONS, json: true}).then(([response, body]) => {
  if (response.statusCode !== 200) throw new Error();
  return _.head(body);
});

const nodeP = versionsP.get('version').then(_.trimCharsStart('v'));
const npmP = versionsP.get('npm');

const updateTravis = (node, travis) => {
  if (_.isArray(travis)) return Promise.map(travis, t => updateTravis(node, t));

  if (!travis || !node) return Promise.resolve();

  const travisYamlPath = path.join(process.cwd(), travis);
  const travisYamlP = readFile(travisYamlPath, 'utf8').then(yaml.safeLoad);

  const newTravisYamlP = travisYamlP.then(_.set('node_js.0', node));

  return newTravisYamlP
    .then(yaml.safeDump)
    .then(newTravisYaml => writeFile(travisYamlPath, newTravisYaml, 'utf8'))
    .tap(() => process.stdout.write(`Write ${travis}\n`));
};

const updatePackage = (node, npm, pkg) => {
  if (_.isArray(pkg)) return Promise.map(pkg, p => updatePackage(node, npm, p));

  if (!pkg) return Promise.resolve();

  const packagePath = path.join(process.cwd(), pkg);
  const packageP = readFile(packagePath, 'utf8').then(JSON.parse);

  const newPackageP = packageP
    .then(node ? _.set('engines.node', `^${node}`) : _.identity)
    .then(npm ? _.set('engines.npm', `^${npm}`) : _.identity);

  return newPackageP
    .then(obj => JSON.stringify(obj, null, 2))
    .then(newPackage => writeFile(packagePath, `${newPackage}\n`, 'utf8'))
    .tap(() => process.stdout.write(`Write ${pkg}\n`));
};

const updateNvmrc = (node, nvmrc) => {
  if (_.isArray(nvmrc)) return Promise.map(nvmrc, u => updateNvmrc(node, u));

  if (!nvmrc || !node) return Promise.resolve();

  const nvmrcPath = path.join(process.cwd(), nvmrc);
  return writeFile(nvmrcPath, `v${node}\n`, 'utf8').tap(() =>
    process.stdout.write(`Write ${nvmrc}\n`)
  );
};

const updateDockerfile = (node, dockerfile) => {
  if (_.isArray(dockerfile)) return Promise.map(dockerfile, d => updateDockerfile(node, d));

  if (!dockerfile || !node) return Promise.resolve();

  const dockerFilePath = path.join(process.cwd(), dockerfile);
  const dockerFileP = readFile(dockerFilePath, 'utf8');

  const newDockerFileP = dockerFileP.then(
    _.replace(/FROM node:\d+\.\d+\.\d+/, `FROM node:${node}`)
  );

  return newDockerFileP
    .then(newDockerFile => writeFile(dockerFilePath, newDockerFile, 'utf8'))
    .tap(() => process.stdout.write(`Write ${dockerfile}\n`));
};

const executeScript = _.pipe(
  _.trim,
  _.split('\n'),
  _.reduce((acc, cmd) => acc.then(() => exec(cmd)), Promise.resolve())
);

const commitFiles = message =>
  executeScript(
    `
    git add .
    git commit -m "${message}"
    `
  )
    .tap(() => process.stdout.write(`Commit files\n`))
    .tapCatch(() => process.stderr.write('Nothing to commit\n'));

const pushFiles = (head, message) =>
  executeScript(
    `
    git push origin HEAD:refs/heads/${head} -f
    `
  ).tap(() => process.stdout.write(`Push files on ${head}\n`));

const searchPullRequest = (repoSlug, head, base, githubToken) => {
  return request({
    uri: `https://api.github.com/repos/${repoSlug}/pulls`,
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${githubToken}`
    },
    qs: {
      head,
      base
    },
    json: true
  })
    .then(([response, body]) => {
      if (response.statusCode === 200) return Promise.resolve(body);
      return Promise.reject(new Error(_.get('message', body)));
    })
    .get(0);
};

const createPullRequest = (repoSlug, head, base, message, githubToken) =>
  request({
    uri: `https://api.github.com/repos/${repoSlug}/pulls`,
    method: 'POST',
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${githubToken}`
    },
    json: true,
    body: {
      title: message,
      head,
      base
    }
  })
    .then(([response, body]) => {
      if (response.statusCode === 201) return Promise.resolve(body);
      if (response.statusCode === 422) return searchPullRequest(repoSlug, head, base, githubToken);
      return Promise.reject(new Error(_.get('message', body)));
    })
    .tap(() => process.stdout.write(`Create pull request\n`));

const assignReviewers = ({reviewers = [], team_reviewers = []} = {}, pullRequest, githubToken) => {
  if (!githubToken || !pullRequest) return Promise.resolve();

  const {url} = pullRequest;
  return request({
    uri: `${url}/requested_reviewers`,
    method: 'POST',
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.thor-preview+json',
      Authorization: `token ${githubToken}`
    },
    json: true,
    body: {
      reviewers,
      team_reviewers
    }
  })
    .then(([response, body]) => {
      if (response.statusCode === 201) return Promise.resolve();
      return Promise.reject(new Error(_.get('message', body)));
    })
    .tap(() => process.stdout.write(`Create assignations\n`));
};

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
      pushFiles(head, message)
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
    Promise.all([nodeP, parseArgvToArray(argv.dockerfile)]).spread(updateDockerfile)
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
