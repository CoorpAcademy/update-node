const Request = require('request');
const Promise = require('bluebird');
const c = require('chalk');
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
      head: `${repoSlug.split('/')[0]}:${head}`,
      base
    },
    json: true
  })
    .then(([response, body]) => {
      if (response.statusCode === 200) return body;
      throw new Error(_.get('message', body));
    })
    .get(0);
};

const createPullRequest = (repoSlug, head, base, title, body, githubToken) => {
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
      body
    }
  })
    .then(([response, responseBody]) => {
      if (response.statusCode === 201) return responseBody;
      if (response.statusCode === 422) return searchPullRequest(repoSlug, head, base, githubToken);
      throw new Error(_.get('message', responseBody));
    })
    .tap(() => process.stdout.write('  - 📬  Create/Update pull request\n'));
};

const assignReviewers = (reviewerConfig, pullRequest, githubToken) => {
  // FIXIME: ignore author
  if (!githubToken || !pullRequest) return Promise.resolve();
  const {reviewers = [], team_reviewers = []} = reviewerConfig || {};
  if (_.isEmpty(reviewers) && _.isEmpty(team_reviewers)) return Promise.resolve();

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
      if (response.statusCode === 201) return;
      throw new Error(_.get('message', body));
    })
    .tap(() =>
      process.stdout.write(
        `  - 👥  Create assignations ${[...reviewers, ...team_reviewers]
          .map(r => `@${c.dim.bold(r)}`)
          .join(', ')}\n`
      )
    );
};
const documentPullRequest = ({label, body, title}, pullRequest, githubToken) => {
  if (!githubToken || !pullRequest || !label) return Promise.resolve();

  const {issue_url} = pullRequest;
  const labels = _.pipe(_.map('name'), label ? _.union([label]) : _.identity)(pullRequest.labels);
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
      labels,
      body,
      title
    }
  })
    .then(([response, responseBody]) => {
      if (response.statusCode === 200) return;
      throw new Error(_.get('message', responseBody));
    })
    .tap(() => process.stdout.write('  - 🏷  Added label\n'));
};

const syncGithub = async (repoSlug, base, branch, message, pullRequestContent, githubToken) => {
  if (!branch) return {};
  const branchHasCommits = await commitFiles(branch, message);
  if (!branchHasCommits) {
    return {commit: null, branch};
  }
  const {
    body = '',
    title = message,
    team_reviewers = [],
    reviewers = [],
    label = ''
  } = pullRequestContent || {};

  const commit = headCommit();
  try {
    await pushFiles(branch, githubToken, repoSlug);
    process.stdout.write(`+ Pushed files on ${c.yellow.bold(branch)} 📡\n`);
    const pullRequest = await createPullRequest(repoSlug, branch, base, title, body, githubToken);
    await Promise.all([
      documentPullRequest({label, body, title}, pullRequest, githubToken), // TODO handle assignee!
      assignReviewers({team_reviewers, reviewers}, pullRequest, githubToken).catch(err =>
        process.stdout.write(`Issue occured while adding reviewers ${c.yellow.bold(err.message)} 📡\n`)
      )
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
