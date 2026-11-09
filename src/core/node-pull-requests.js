const got = require('got').default;
const {major, minor} = require('semver');
const {commitDetails} = require('./git');

const createNodeUpgradeTarget = (version, scope = '', prefix = 'update-node') => ({
  major: major(version),
  minor: minor(version),
  scope,
  prefix
});

const nodeUpgradeBranch = ({major: nodeMajor, minor: nodeMinor, scope, prefix}) =>
  [prefix, scope, `v${nodeMajor}.${nodeMinor}`].filter(Boolean).join('-');

const nodeUpgradeMarker = target => `<!-- update-node: ${JSON.stringify(target)} -->`;

const readNodeUpgradeTarget = body => {
  const match = (body || '').match(/^<!-- update-node: (.+) -->$/m);
  if (!match) return null;
  try {
    const target = JSON.parse(match[1]);
    return target &&
      Number.isInteger(target.major) &&
      target.major > 0 &&
      Number.isInteger(target.minor) &&
      target.minor >= 0 &&
      typeof target.prefix === 'string' &&
      target.prefix &&
      typeof target.scope === 'string'
      ? target
      : null;
  } catch (err) {
    return null;
  }
};

const isGeneratedNodePullRequest = (pr, target, repoSlug, base) =>
  Boolean(
    target &&
    pr.head?.repo?.full_name?.toLowerCase() === repoSlug.toLowerCase() &&
    pr.base?.ref === base &&
    pr.head.ref === nodeUpgradeBranch(target)
  );

const isSupersededNodePullRequest = (pr, replacement, target, repoSlug, base, login) => {
  const previous = readNodeUpgradeTarget(pr.body);
  return Boolean(
    isGeneratedNodePullRequest(pr, previous, repoSlug, base) &&
    pr.number !== replacement.number &&
    pr.state === 'open' &&
    pr.user?.login === login &&
    previous.prefix === target.prefix &&
    previous.scope === target.scope &&
    (previous.major < target.major ||
      (previous.major === target.major && previous.minor < target.minor))
  );
};

const listPages = async (url, options, request) => {
  const items = [];
  for (let page = 1; ; page++) {
    const {body} = await request(url, {
      ...options,
      searchParams: {...options.searchParams, per_page: 100, page}
    });
    items.push(...body);
    if (body.length < 100) return items;
  }
};

const requestOptions = token => ({
  headers: {Authorization: `token ${token}`, 'User-Agent': 'update-node'},
  responseType: 'json',
  timeout: {request: 10000},
  retry: {limit: 0}
});

const closeSupersededNodePullRequests = async (
  {repoSlug, baseBranch, token},
  replacement,
  request = got
) => {
  const target = readNodeUpgradeTarget(replacement.body);
  if (
    !replacement.merged_at ||
    !isGeneratedNodePullRequest(replacement, target, repoSlug, baseBranch)
  )
    return;
  const options = requestOptions(token);
  const {body: user} = await request('https://api.github.com/user', options);
  if (replacement.user?.login !== user.login) return;
  const prs = await listPages(
    `https://api.github.com/repos/${repoSlug}/pulls`,
    {...options, searchParams: {state: 'open', base: baseBranch}},
    request
  );
  const superseded = prs.filter(pr =>
    isSupersededNodePullRequest(pr, replacement, target, repoSlug, baseBranch, user.login)
  );
  const comment = `Superseeded by #${replacement.number}`;
  for (const {number} of superseded) {
    try {
      const url = `https://api.github.com/repos/${repoSlug}/issues/${number}/comments`;
      const comments = await listPages(url, options, request);
      if (!comments.some(existing => existing.body === comment))
        await request.post(url, {...options, json: {body: comment}});
      await request.patch(`https://api.github.com/repos/${repoSlug}/pulls/${number}`, {
        ...options,
        json: {state: 'closed'}
      });
      process.stdout.write(`- Closed superseded Node upgrade PR #${number}.\n`);
    } catch (error) {
      process.stderr.write(
        `Warning: Could not clean up Node upgrade PR #${number}: ${error.message}\n`
      );
    }
  }
};

const isMergedAt = (pr, sha, {repoSlug, baseBranch}) =>
  pr.merged_at &&
  pr.merge_commit_sha === sha &&
  pr.base?.ref === baseBranch &&
  pr.base?.repo?.full_name?.toLowerCase() === repoSlug.toLowerCase();

const findMergedHeadPullRequest = async (config, request, readCommit) => {
  const head = readCommit();
  const options = requestOptions(config.token);
  const url = `https://api.github.com/repos/${config.repoSlug}`;
  const prs = await listPages(`${url}/commits/${head.sha}/pulls`, options, request);
  const merged = prs
    .filter(pr => isMergedAt(pr, head.sha, config))
    .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at) || b.number - a.number);
  if (merged.length > 0) return merged[0];

  const summary = head.message.match(/^Merge pull request #(\d+) from ([^\s]+)\s*$/m);
  if (!summary || head.parents.length !== 1) return null;
  const parent = readCommit(head.parents[0]);
  if (head.tree !== parent.tree) return null;
  const {body: summaryPr} = await request(`${url}/pulls/${summary[1]}`, options);
  const source = `${summaryPr.head?.repo?.owner?.login}/${summaryPr.head?.ref}`;
  return isMergedAt(summaryPr, parent.sha, config) && source === summary[2] ? summaryPr : null;
};

const cleanupNodePullRequests = async (
  config,
  {request = got, readCommit = commitDetails} = {}
) => {
  if (config.local || !config.token) return;
  try {
    const replacement = await findMergedHeadPullRequest(config, request, readCommit);
    if (replacement) await closeSupersededNodePullRequests(config, replacement, request);
  } catch (error) {
    process.stderr.write(
      `Warning: Could not check superseded Node upgrade PRs: ${error.message}\n`
    );
  }
};

module.exports = {
  createNodeUpgradeTarget,
  nodeUpgradeBranch,
  nodeUpgradeMarker,
  isSupersededNodePullRequest,
  closeSupersededNodePullRequests,
  cleanupNodePullRequests
};
