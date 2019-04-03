const Request = require('request');
const Promise = require('bluebird');
const _ = require('lodash/fp');
const {commitFiles, pushFiles, headCommit} = require('./git');

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

const createPullRequest = (repoSlug, head, base, message, githubToken) => {
  const lines = _.split('\n', message);
  const title = lines[0];
  const bdy = _.pipe(_.slice(1), _.join('\n'))(lines);
  return request({
    uri: `https://api.github.com/repos/${repoSlug}/pulls`,
    method: 'POST',
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${githubToken}`
    },
    json: true,
    body: {
      title,
      head,
      base,
      maintainer_can_modify: true,
      body: bdy
    }
  })
    .then(([response, body]) => {
      if (response.statusCode === 201) return Promise.resolve(body);
      if (response.statusCode === 422) return searchPullRequest(repoSlug, head, base, githubToken);
      return Promise.reject(new Error(_.get('message', body)));
    })
    .tap(() => process.stdout.write('  - Create pull request\n'));
};

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
    .tap(() => process.stdout.write('  - Create assignations\n'));
};
const documentPr = ({label, message}, pullRequest, githubToken) => {
  if (!githubToken || !pullRequest || !label) return Promise.resolve();

  const {issue_url} = pullRequest;
  return request({
    uri: issue_url,
    method: 'PATCH',
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.symmetra-preview+json',
      Authorization: `token ${githubToken}`
    },
    json: true,
    body: {
      labels: [label],
      body: message.replace(/[^\n]*[\n]/, '')
    }
  })
    .then(([response, body]) => {
      if (response.statusCode === 200) return Promise.resolve();
      return Promise.reject(new Error(_.get('message', body)));
    })
    .tap(() => process.stdout.write('  - Added label\n'));
};

const syncGithub = async (
  repoSlug,
  base,
  branch,
  message,
  {team_reviewers = [], reviewers = [], label = ''} = {},
  githubToken
) => {
  if (!branch) return;

  const branchHasCommits = await commitFiles(branch, message);
  if (!branchHasCommits) {
    return {commit: null, branch};
  }
  const commit = headCommit();
  try {
    await pushFiles(branch, message, githubToken, repoSlug);
    const pullRequest = await createPullRequest(repoSlug, branch, base, message, githubToken);
    await Promise.all([
      documentPr({message, label}, pullRequest, githubToken), // TODO handle asignee
      assignReviewers({team_reviewers, reviewers}, pullRequest, githubToken)
    ]);
    return {commit, branch, pullRequest};
  } catch (err) {
    return {commit, branch, error: err};
  }
};

module.exports = {
  createPullRequest,
  syncGithub,
  assignReviewers
};
