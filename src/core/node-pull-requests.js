const got = require('got').default;
const {major, minor} = require('semver');

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
    return JSON.parse(match[1]);
  } catch (err) {
    return null;
  }
};

const isSupersededNodePullRequest = (pr, replacement, target, repoSlug, base, login) => {
  const previous = readNodeUpgradeTarget(pr.body);
  return Boolean(
    previous &&
    pr.number !== replacement.number &&
    pr.state === 'open' &&
    pr.user.login === login &&
    pr.head.repo &&
    pr.head.repo.full_name.toLowerCase() === repoSlug.toLowerCase() &&
    pr.base.ref === base &&
    previous.prefix === target.prefix &&
    previous.scope === target.scope &&
    previous.major === target.major &&
    previous.minor < target.minor &&
    pr.head.ref === nodeUpgradeBranch(previous)
  );
};

const closeSupersededNodePullRequests = async (
  {repoSlug, baseBranch, token},
  replacement,
  target,
  request = got
) => {
  const options = {
    headers: {Authorization: `token ${token}`, 'User-Agent': 'update-node'},
    responseType: 'json'
  };
  const {body: user} = await request('https://api.github.com/user', options);
  if (replacement.user.login !== user.login) return;
  const superseded = [];
  for (let page = 1; ; page++) {
    const {body: prs} = await request(`https://api.github.com/repos/${repoSlug}/pulls`, {
      ...options,
      searchParams: {state: 'open', base: baseBranch, per_page: 100, page}
    });
    for (const pr of prs) {
      if (!isSupersededNodePullRequest(pr, replacement, target, repoSlug, baseBranch, user.login))
        continue;
      superseded.push(pr.number);
    }
    if (prs.length < 100) break;
  }
  for (const number of superseded) {
    await request.patch(`https://api.github.com/repos/${repoSlug}/pulls/${number}`, {
      ...options,
      json: {state: 'closed'}
    });
    process.stdout.write(`- Closed superseded Node upgrade PR #${number}.\n`);
  }
};

module.exports = {
  createNodeUpgradeTarget,
  nodeUpgradeBranch,
  nodeUpgradeMarker,
  isSupersededNodePullRequest,
  closeSupersededNodePullRequests
};
