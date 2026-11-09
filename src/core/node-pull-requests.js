const c = require('chalk').default;
const got = require('got').default;
const {major, minor, patch, valid} = require('semver');
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

const readNodePullRequestTarget = pr => {
  const target = readNodeUpgradeTarget(pr.body);
  const title = (pr.title || '').match(/^(?:\[([^\]\r\n]+)\] )?Upgrade Node to v(\d+\.\d+\.\d+)$/);
  const version = title && valid(title[2]);
  if (target) {
    const matchingVersion =
      version && major(version) === target.major && minor(version) === target.minor;
    return {...target, patch: matchingVersion ? patch(version) : 0, legacy: false};
  }
  // An invalid marker must not bypass metadata validation through legacy detection.
  if (!version || (pr.body || '').includes('<!-- update-node:')) return null;
  const body = (pr.body || '').match(/^:rocket: Upgraded Node version to v(\d+\.\d+\.\d+)(?:$|\s)/);
  if (!body || body[1] !== version) return null;
  const scope = title[1] || '';
  if (scope && !pr.body.endsWith(` on scope ${scope}`)) return null;
  const suffix = `-${scope ? `${scope}-` : ''}v${version}`;
  const branch = pr.head?.ref || '';
  if (!branch.endsWith(suffix) || branch.length === suffix.length) return null;
  return {
    ...createNodeUpgradeTarget(version, scope, branch.slice(0, -suffix.length)),
    patch: patch(version),
    legacy: true
  };
};

const compareNodeUpgradeTargets = (a, b) =>
  a.major - b.major || a.minor - b.minor || (a.patch || 0) - (b.patch || 0);

const matchesNodeUpgradePrefix = (previous, target) =>
  previous.prefix === target.prefix ||
  ((previous.legacy || target.legacy) &&
    [previous.prefix, target.prefix].every(prefix =>
      ['update-node', 'upgrade-node'].includes(prefix)
    ));

const isGeneratedNodePullRequest = (pr, target, repoSlug, base) =>
  Boolean(
    target &&
    pr.head?.repo?.full_name?.toLowerCase() === repoSlug.toLowerCase() &&
    pr.base?.ref === base &&
    pr.head.ref === `${nodeUpgradeBranch(target)}${target.legacy ? `.${target.patch}` : ''}`
  );

const isSupersededNodePullRequest = (pr, replacement, target, repoSlug, base) => {
  const previous = readNodePullRequestTarget(pr);
  return Boolean(
    isGeneratedNodePullRequest(pr, previous, repoSlug, base) &&
    pr.number !== replacement.number &&
    pr.state === 'open' &&
    matchesNodeUpgradePrefix(previous, target) &&
    previous.scope === target.scope &&
    (compareNodeUpgradeTargets(previous, target) < 0 ||
      (compareNodeUpgradeTargets(previous, target) === 0 && previous.legacy && !target.legacy))
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

const commentAndCloseNodePullRequest = async (config, number, replacementNumber, request) => {
  const options = requestOptions(config.token);
  const comment = `Superseeded by #${replacementNumber}`;
  try {
    const url = `https://api.github.com/repos/${config.repoSlug}/issues/${number}/comments`;
    const comments = await listPages(url, options, request);
    if (!comments.some(existing => existing.body === comment))
      await request.post(url, {...options, json: {body: comment}});
    await request.patch(`https://api.github.com/repos/${config.repoSlug}/pulls/${number}`, {
      ...options,
      json: {state: 'closed'}
    });
    process.stdout.write(`🧹 Closed superseded Node upgrade PR ${c.bold(`#${number}`)}.\n`);
    return true;
  } catch (error) {
    process.stderr.write(
      `⚠️ Warning: Could not clean up Node upgrade PR ${c.bold(`#${number}`)}: ${error.message}\n`
    );
    return false;
  }
};

const closeSupersededNodePullRequests = async (config, replacement, request = got) => {
  const {repoSlug, baseBranch, token} = config;
  const target = readNodePullRequestTarget(replacement);
  if (
    !replacement.merged_at ||
    !isGeneratedNodePullRequest(replacement, target, repoSlug, baseBranch)
  )
    return;
  const options = requestOptions(token);
  const prs = await listPages(
    `https://api.github.com/repos/${repoSlug}/pulls`,
    {...options, searchParams: {state: 'open', base: baseBranch}},
    request
  );
  const superseded = prs.filter(pr =>
    isSupersededNodePullRequest(pr, replacement, target, repoSlug, baseBranch)
  );
  for (const {number} of superseded)
    await commentAndCloseNodePullRequest(config, number, replacement.number, request);
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
      `⚠️ Warning: Could not check superseded Node upgrade PRs: ${error.message}\n`
    );
  }
};

const cleanupAllNodePullRequests = async (config, {request = got} = {}) => {
  if (config.local || !config.token) {
    process.stdout.write(
      `⏭️ Skipped PR cleanup: ${config.local ? 'local mode' : 'no GitHub token'}.\n`
    );
    return;
  }
  const {repoSlug, baseBranch, token} = config;
  const options = requestOptions(token);
  try {
    process.stdout.write(
      `${c.bold.blue(`🔎 Checking Node upgrade PRs in ${repoSlug} targeting ${baseBranch}.`)}\n`
    );
    const url = `https://api.github.com/repos/${repoSlug}/pulls`;
    const open = await listPages(
      url,
      {...options, searchParams: {state: 'open', base: baseBranch}},
      request
    );
    const candidates = open.filter(pr =>
      isGeneratedNodePullRequest(pr, readNodePullRequestTarget(pr), repoSlug, baseBranch)
    );
    process.stdout.write(
      `📋 Found ${c.bold(open.length)} open PRs; ${c.bold(candidates.length)} match generated Node upgrade formats.\n`
    );
    if (candidates.length === 0) {
      process.stdout.write('ℹ️ No eligible generated Node upgrade PRs. No changes made.\n');
      return;
    }
    const closed = await listPages(
      url,
      {...options, searchParams: {state: 'closed', base: baseBranch}},
      request
    );
    const merged = closed
      .map(pr => ({pr, target: readNodePullRequestTarget(pr)}))
      .filter(
        ({pr, target}) =>
          pr.merged_at && isGeneratedNodePullRequest(pr, target, repoSlug, baseBranch)
      )
      .sort(
        (a, b) =>
          compareNodeUpgradeTargets(b.target, a.target) ||
          new Date(b.pr.merged_at) - new Date(a.pr.merged_at) ||
          b.pr.number - a.pr.number
      );
    const newestOpen = candidates
      .map(pr => ({pr, target: readNodePullRequestTarget(pr)}))
      .sort(
        (a, b) =>
          compareNodeUpgradeTargets(b.target, a.target) ||
          Number(a.target.legacy) - Number(b.target.legacy) ||
          b.pr.number - a.pr.number
      );
    let superseded = 0;
    let closedCount = 0;
    for (const candidate of candidates) {
      const candidateTarget = readNodePullRequestTarget(candidate);
      const supersedes = ({pr, target}) =>
        isSupersededNodePullRequest(candidate, pr, target, repoSlug, baseBranch);
      const replacement =
        merged.find(supersedes) ||
        newestOpen.find(item => item.target.major === candidateTarget.major && supersedes(item));
      if (replacement) {
        superseded++;
        const closedSuccessfully = await commentAndCloseNodePullRequest(
          config,
          candidate.number,
          replacement.pr.number,
          request
        );
        if (closedSuccessfully) closedCount++;
      }
    }
    process.stdout.write(
      `${superseded === closedCount ? '✅' : '⚠️'} Cleanup complete: ${c.bold(closedCount)} PRs closed, ${c.bold(candidates.length - superseded)} kept, ${c.bold(superseded - closedCount)} failed.\n`
    );
  } catch (error) {
    process.stderr.write(
      `⚠️ Warning: Could not check superseded Node upgrade PRs: ${error.message}\n`
    );
  }
};

module.exports = {
  createNodeUpgradeTarget,
  nodeUpgradeBranch,
  nodeUpgradeMarker,
  isSupersededNodePullRequest,
  closeSupersededNodePullRequests,
  cleanupNodePullRequests,
  cleanupAllNodePullRequests
};
