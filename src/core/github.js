const got = require('got');
const Promise = require('bluebird');
const c = require('chalk');
const _ = require('lodash/fp');
const {commitFiles, pushFiles, headCommit} = require('./git');

const searchPullRequest = async (repoSlug, head, base, githubToken) => {
  const response = await got(`https://api.github.com/repos/${repoSlug}/pulls`, {
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${githubToken}`
    },
    searchParams: {
      head: `${repoSlug.split('/')[0]}:${head}`,
      base
    },
    responseType: 'json'
  });

  if (response.statusCode === 200) {
    const matchingPullRequests = response.body;
    return matchingPullRequests[0];
  }
  throw new Error(_.get('message', response.body));
};

const createPullRequest = async (repoSlug, head, base, title, body, githubToken) => {
  const response = await got.post(`https://api.github.com/repos/${repoSlug}/pulls`, {
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${githubToken}`
    },
    responseType: 'json',
    throwHttpErrors: false,
    json: {
      title,
      head,
      base,
      maintainer_can_modify: true,
      body
    }
  });

  if (response.statusCode === 201) {
    process.stdout.write('  - 📬  Create/Update pull request\n');
    return response.body;
  }
  if (response.statusCode === 422)
    // Pull request alredy exists, returning it
    return searchPullRequest(repoSlug, head, base, githubToken);
  // check if necessary with got retry
  throw new Error(_.get('message', response.body));
};

const assignReviewers = async (reviewerConfig, pullRequest, githubToken) => {
  // TODO: remove author from the list of reviewers
  if (!githubToken || !pullRequest) return;
  const {reviewers = [], team_reviewers = []} = reviewerConfig || {};
  if (_.isEmpty(reviewers) && _.isEmpty(team_reviewers)) return;

  const {url} = pullRequest;
  try {
    const response = await got.post(`${url}/requested_reviewers`, {
      headers: {
        'User-Agent': 'Travis',
        Accept: 'application/vnd.github.thor-preview+json',
        Authorization: `token ${githubToken}`
      },
      responseType: 'json',
      json: {
        reviewers,
        team_reviewers
      }
    });

    if (response.statusCode === 201) return;
    throw new Error(_.get('message', response.body));
  } catch (err) {
    process.stdout.write(
      `Issue occurred while adding reviewers ${c.yellow.bold(err.message)} 📡\n`
    );
  }

  process.stdout.write(
    `  - 👥  Create assignations ${[...reviewers, ...team_reviewers]
      .map(r => `@${c.dim.bold(r)}`)
      .join(', ')}\n`
  );
};
const documentPullRequest = async ({label, body, title}, pullRequest, githubToken) => {
  if (!githubToken || !pullRequest || !label) return;

  const {issue_url} = pullRequest;
  const labels = _.pipe(_.map('name'), label ? _.union([label]) : _.identity)(pullRequest.labels);

  const response = await got.patch(issue_url, {
    headers: {
      'User-Agent': 'Travis',
      Accept: 'application/vnd.github.symmetra-preview+json',
      Authorization: `token ${githubToken}`
    },
    responseType: 'json',
    json: {
      labels,
      body,
      title
    }
  });

  if (response.statusCode === 200) {
    process.stdout.write('  - 🏷  Added label\n');
    return;
  }
  throw new Error(_.get('message', await response.body));
};

const syncGithub = async (
  repoSlug,
  base,
  branch,
  message,
  pullRequestContent,
  githubToken,
  forceFlag
) => {
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
    await pushFiles(branch, githubToken, repoSlug, {forceFlag});
    process.stdout.write(`+ Pushed files on ${c.yellow.bold(branch)} 📡\n`);
    const pullRequest = await createPullRequest(repoSlug, branch, base, title, body, githubToken);
    await Promise.all([
      documentPullRequest({label, body, title}, pullRequest, githubToken), // TODO handle assignee!
      assignReviewers({team_reviewers, reviewers}, pullRequest, githubToken).catch(err =>
        process.stdout.write(
          `Issue occured while adding reviewers ${c.yellow.bold(err.message)} 📡\n`
        )
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
