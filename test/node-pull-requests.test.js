const test = require('ava').default;
const {
  cleanupNodePullRequests, createNodeUpgradeTarget, nodeUpgradeBranch, nodeUpgradeMarker
} = require('../src/core/node-pull-requests');

const pr = (number, version) => {
  const target = createNodeUpgradeTarget(version, 'api');
  return {
    number, state: 'open', user: {login: 'bot'}, body: nodeUpgradeMarker(target),
    head: {ref: nodeUpgradeBranch(target), repo: {full_name: 'org/repo', owner: {login: 'org'}}},
    base: {ref: 'master', repo: {full_name: 'org/repo'}}
  };
};

const fixture = (options = {}) => {
  const config = {repoSlug: 'org/repo', baseBranch: 'master', token: 'fake'};
  const replacement = {
    ...pr(200, '24.10.3'), state: 'closed', merged_at: '2026-11-09T12:00:00Z', merge_commit_sha: 'head-sha'
  };
  const head = {sha: 'head-sha', tree: 'tree', parents: ['previous-sha'], message: 'Merged Node upgrade'};
  const parent = {sha: 'previous-sha', tree: 'tree', parents: [], message: 'Previous commit'};
  const candidates = [pr(1, '22.23.0'), pr(2, '24.9.1'), pr(3, '26.0.0')];
  const events = [];
  const comments = new Map();
  const associated = [replacement];
  const readCommit = (ref = 'HEAD') => {
    events.push(['read', ref]);
    return ref === 'HEAD' ? head : parent;
  };
  const request = async (url, requestOptions) => {
    if (url.endsWith('/user')) {
      events.push(['actor']);
      return {body: {login: options.login || 'bot'}};
    }
    if (url.includes('/commits/')) {
      events.push(['detect', requestOptions.searchParams.page]);
      if (options.failDetection) throw new Error('lookup failed');
      return {body: associated};
    }
    if (url.endsWith('/pulls/200')) {
      events.push(['summary-pr']);
      return {body: replacement};
    }
    const page = requestOptions.searchParams.page;
    if (url.endsWith('/comments')) {
      const number = Number(url.split('/').at(-2));
      events.push(['comments', number, page]);
      if (options.failCommentRead === number) throw new Error('comments unavailable');
      return {body: (comments.get(number) || []).slice((page - 1) * 100, page * 100)};
    }
    events.push(['list', page]);
    return {body: candidates.filter(item => item.state === 'open').slice((page - 1) * 100, page * 100)};
  };
  request.post = async (url, requestOptions) => {
    const number = Number(url.split('/').at(-2));
    events.push(['comment', number, requestOptions.json.body]);
    if (options.failComment === number) throw new Error('comment rejected');
    comments.set(number, [...comments.get(number) || [], {body: requestOptions.json.body}]);
  };
  request.patch = async (url, requestOptions) => {
    const number = Number(url.split('/').at(-1));
    events.push(['close', number]);
    if (options.failClose === number) throw new Error('close rejected');
    candidates.find(item => item.number === number).state = requestOptions.json.state;
  };
  const run = () => cleanupNodePullRequests(config, {request, readCommit});
  return {config, replacement, head, parent, candidates, events, comments, associated, run, options};
};

test('a merged Node PR comments before closing lower versions and keeps higher alternatives', async t => {
  const f = fixture();
  await f.run();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'open']);
  t.deepEqual(f.events.filter(event => ['comment', 'close'].includes(event[0])), [
    ['comment', 1, 'Superseeded by #200'], ['close', 1],
    ['comment', 2, 'Superseeded by #200'], ['close', 2]
  ]);
});

test('an empty fast-forward summary resolves its merged parent PR', async t => {
  const f = fixture();
  f.associated.length = 0;
  f.replacement.merge_commit_sha = f.parent.sha;
  f.head.message = 'Upgrade Node :arrow_up: (#200)\n\nMerge pull request #200 from org/update-node-api-v24.10\n';
  await f.run();
  t.true(f.events.some(event => event[0] === 'summary-pr'));
  t.deepEqual(f.events.filter(event => event[0] === 'read'), [['read', 'HEAD'], ['read', 'previous-sha']]);
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'open']);
});

for (const mismatch of ['tree', 'merge-sha', 'source', 'multiple-parents']) {
  test(`a fast-forward summary with mismatched ${mismatch} cannot trigger cleanup`, async t => {
    const f = fixture();
    f.associated.length = 0;
    f.head.message = 'Merge pull request #200 from org/update-node-api-v24.10';
    f.replacement.merge_commit_sha = f.parent.sha;
    if (mismatch === 'tree') f.head.tree = 'changed-tree';
    if (mismatch === 'merge-sha') f.replacement.merge_commit_sha = 'unrelated-sha';
    if (mismatch === 'source') f.head.message = 'Merge pull request #200 from org/manual';
    if (mismatch === 'multiple-parents') f.head.parents.push('another-parent');
    await f.run();
    t.false(f.events.some(event => ['actor', 'list', 'comment', 'close'].includes(event[0])));
  });
}

for (const mismatch of ['unmerged', 'historical', 'base', 'manual', 'marker', 'fork', 'branch', 'actor']) {
  test(`a ${mismatch} PR at HEAD does not close bump alternatives`, async t => {
    const f = fixture();
    if (mismatch === 'unmerged') f.replacement.merged_at = null;
    if (mismatch === 'historical') f.replacement.merge_commit_sha = 'older-sha';
    if (mismatch === 'base') f.replacement.base.ref = 'develop';
    if (mismatch === 'manual') f.replacement.body = 'Human-authored PR';
    if (mismatch === 'marker') f.replacement.body = '<!-- update-node: {"major":24} -->';
    if (mismatch === 'fork') f.replacement.head.repo.full_name = 'fork/repo';
    if (mismatch === 'branch') f.replacement.head.ref = 'manual';
    if (mismatch === 'actor') f.options.login = 'someone-else';
    await f.run();
    t.false(f.events.some(event => ['list', 'comment', 'close'].includes(event[0])));
  });
}

test('the most recently merged PR at HEAD takes precedence over an older generated PR', async t => {
  const f = fixture();
  f.associated.push({...f.replacement, number: 201, merged_at: '2026-11-09T13:00:00Z', body: 'Manual wrapper PR'});
  await f.run();
  t.false(f.events.some(event => ['actor', 'list', 'comment', 'close'].includes(event[0])));
});

test('no associated PR means no scan of older history', async t => {
  const f = fixture();
  f.associated.length = 0;
  await f.run();
  t.deepEqual(f.events, [['read', 'HEAD'], ['detect', 1]]);
});

for (const property of ['local', 'token']) {
  test(`${property === 'local' ? 'local mode' : 'a missing token'} performs no GitHub lookup`, async t => {
    const f = fixture();
    if (property === 'local') f.config.local = true;
    else delete f.config.token;
    await f.run();
    t.deepEqual(f.events, []);
  });
}

test('existing comments are found across pages and reused', async t => {
  const f = fixture();
  f.comments.set(1, [...Array.from({length: 100}, () => ({body: 'Unrelated discussion'})), {body: 'Superseeded by #200'}]);
  await f.run();
  t.true(f.events.some(event => event[0] === 'comments' && event[1] === 1 && event[2] === 2));
  t.false(f.events.some(event => event[0] === 'comment' && event[1] === 1));
  t.is(f.candidates[0].state, 'closed');
});

for (const failure of ['failComment', 'failCommentRead', 'failClose']) {
  test(`${failure} leaves the affected PR open and continues other candidates`, async t => {
    const f = fixture({[failure]: 1});
    await t.notThrowsAsync(f.run());
    t.deepEqual(f.candidates.map(item => item.state), ['open', 'closed', 'open']);
    if (failure !== 'failClose') t.false(f.events.some(event => event[0] === 'close' && event[1] === 1));
  });
}

test('a retry after a failed close does not duplicate the posted comment', async t => {
  const f = fixture({failClose: 1});
  await f.run();
  delete f.options.failClose;
  await f.run();
  t.is(f.events.filter(event => event[0] === 'comment' && event[1] === 1).length, 1);
  t.is(f.candidates[0].state, 'closed');
});

test('detection failure is non-fatal', async t => {
  const f = fixture({failDetection: true});
  await t.notThrowsAsync(f.run());
  t.false(f.events.some(event => ['list', 'comment', 'close'].includes(event[0])));
});
