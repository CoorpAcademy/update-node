const Request = require('request');
const Promise = require('bluebird');
const _ = require('lodash/fp');
const {commitFiles, pushFiles} = require('./git');

const request = Promise.promisify(Request, {multiArgs: true});

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
    .tap(() => process.stdout.write('Create pull request\n'));

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
    .tap(() => process.stdout.write('Create assignations\n'));
};

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

module.exports = {
  createPullRequest,
  syncGithub,
  assignReviewers
};
