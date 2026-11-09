const test = require('ava').default;
const {
  cleanupNodePullRequests, cleanupAllNodePullRequests,
  createNodeUpgradeTarget, nodeUpgradeBranch, nodeUpgradeMarker
} = require('../src/core/node-pull-requests');

const pr = (number, version, scope = 'api', prefix = 'update-node') => {
  const target = createNodeUpgradeTarget(version, scope, prefix);
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
  const history = [replacement];
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
    if (requestOptions.searchParams.state === 'closed') {
      events.push(['history', page]);
      if (options.failHistory) throw new Error('merged history unavailable');
      return {body: history.slice((page - 1) * 100, page * 100)};
    }
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
  const runAll = () => cleanupAllNodePullRequests(config, {request});
  return {config, replacement, head, parent, candidates, events, comments, associated, history, run, runAll, options};
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

for (const mismatch of ['unmerged', 'historical', 'base', 'manual', 'marker', 'fork', 'branch']) {
  test(`a ${mismatch} PR at HEAD does not close bump alternatives`, async t => {
    const f = fixture();
    if (mismatch === 'unmerged') f.replacement.merged_at = null;
    if (mismatch === 'historical') f.replacement.merge_commit_sha = 'older-sha';
    if (mismatch === 'base') f.replacement.base.ref = 'develop';
    if (mismatch === 'manual') f.replacement.body = 'Human-authored PR';
    if (mismatch === 'marker') f.replacement.body = '<!-- update-node: {"major":24} -->';
    if (mismatch === 'fork') f.replacement.head.repo.full_name = 'fork/repo';
    if (mismatch === 'branch') f.replacement.head.ref = 'manual';
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

const mergedPr = (number, version, scope = 'api', prefix = 'update-node') => ({
  ...pr(number, version, scope, prefix), state: 'closed', merged_at: '2026-11-09T12:00:00Z'
});

const legacyPr = (number, version, scope = '', prefix = 'update-node') => ({
  ...pr(number, version, scope, prefix),
  title: `${scope ? `[${scope}] ` : ''}Upgrade Node to v${version}`,
  body: `:rocket: Upgraded Node version to v${version}${scope ? ` on scope ${scope}` : ''}`,
  head: {...pr(number, version).head, ref: [prefix, scope, `v${version}`].filter(Boolean).join('-')}
});

test('standalone cleanup replaces legacy #18690 with a modern PR for the same version', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates.splice(0, f.candidates.length,
    legacyPr(18690, '26.13.0'),
    {...pr(18708, '26.13.0', '', 'upgrade-node'), title: 'Upgrade Node to v26.13.0'});
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'open']);
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [
    ['comment', 18690, 'Superseeded by #18708']
  ]);
});

test('legacy patch versions are ordered numerically within each major', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates.splice(0, f.candidates.length,
    legacyPr(1, '22.1.2'), legacyPr(2, '22.1.10'), legacyPr(3, '24.0.0'));
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'open', 'open']);
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [['comment', 1, 'Superseeded by #2']]);
});

test('a modern PR cannot replace a legacy PR for a higher patch version', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates.splice(0, f.candidates.length,
    legacyPr(1, '26.13.2'),
    {...pr(2, '26.13.1', '', 'upgrade-node'), title: 'Upgrade Node to v26.13.1'});
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['open', 'closed']);
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [['comment', 2, 'Superseeded by #1']]);
});

test('legacy custom prefixes and scopes remain eligible within their own group', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates.splice(0, f.candidates.length,
    legacyPr(1, '22.1.0', 'api-service', 'custom'),
    legacyPr(2, '22.2.0', 'api-service', 'custom'));
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'open']);
});

for (const mode of ['run', 'runAll']) {
  test(`${mode} recognizes merged legacy patch PRs as replacements`, async t => {
    const f = fixture();
    Object.assign(f.replacement, legacyPr(200, '24.10.3', 'api'), {
      state: 'closed', merged_at: '2026-11-09T12:00:00Z', merge_commit_sha: 'head-sha'
    });
    f.candidates.splice(0, f.candidates.length,
      legacyPr(1, '22.23.0', 'api'), legacyPr(2, '24.10.2', 'api'), legacyPr(3, '26.0.0', 'api'));
    await f[mode]();
    t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'open']);
  });
}

for (const mismatch of ['title', 'body', 'branch', 'fork', 'base', 'scope', 'prefix', 'marker']) {
  test(`legacy recognition preserves the ${mismatch} safeguard`, async t => {
    const f = fixture();
    f.history.length = 0;
    const older = legacyPr(1, '22.1.0');
    if (mismatch === 'title') older.title = 'Manual upgrade';
    if (mismatch === 'body') older.body = ':rocket: Upgraded Node version to v22.2.0';
    if (mismatch === 'branch') older.head.ref = 'update-node-v22.2.0';
    if (mismatch === 'fork') older.head.repo.full_name = 'fork/repo';
    if (mismatch === 'base') older.base.ref = 'develop';
    if (mismatch === 'scope') Object.assign(older, legacyPr(1, '22.1.0', 'api'));
    if (mismatch === 'prefix') Object.assign(older, legacyPr(1, '22.1.0', '', 'custom'));
    if (mismatch === 'marker') older.body += '\n<!-- update-node: invalid -->';
    f.candidates.splice(0, f.candidates.length, older, legacyPr(2, '22.2.0'));
    await f.runAll();
    t.deepEqual(f.candidates.map(item => item.state), ['open', 'open']);
  });
}

test('standalone cleanup closes even the newest open PR when a newer upgrade has merged', async t => {
  const f = fixture();
  f.history.push(mergedPr(201, '26.1.0'));
  f.candidates.push(pr(4, '26.2.0'));
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'closed', 'open']);
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [
    ['comment', 1, 'Superseeded by #201'],
    ['comment', 2, 'Superseeded by #201'],
    ['comment', 3, 'Superseeded by #201']
  ]);
  t.false(f.events.some(event => ['read', 'detect', 'summary-pr'].includes(event[0])));
});

test('standalone cleanup keeps the newest open PR independently within every major', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates.splice(0, f.candidates.length,
    pr(1, '22.1.0'), pr(2, '22.2.0'), pr(3, '22.3.0'),
    pr(4, '24.1.0'), pr(5, '24.2.0'), pr(6, '26.0.0'));
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'open', 'closed', 'open', 'open']);
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [
    ['comment', 1, 'Superseeded by #3'], ['comment', 2, 'Superseeded by #3'],
    ['comment', 4, 'Superseeded by #5']
  ]);
});

test('a qualifying merged replacement takes precedence over a newer open replacement', async t => {
  const f = fixture();
  f.candidates.splice(0, f.candidates.length, pr(1, '22.1.0'), pr(2, '22.3.0'));
  f.history.splice(0, f.history.length, mergedPr(200, '22.2.0'));
  await f.runAll();
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'open']);
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [['comment', 1, 'Superseeded by #200']]);
});

test('standalone cleanup keeps scope and prefix groups independent', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates.splice(0, f.candidates.length,
    pr(1, '22.1.0'), pr(2, '22.3.0'),
    pr(3, '22.1.0', 'web'), pr(4, '22.2.0', 'web'),
    pr(5, '22.1.0', 'api', 'other'), pr(6, '22.4.0', 'api', 'other'));
  await f.runAll();
  t.deepEqual(f.events.filter(event => event[0] === 'comment'), [
    ['comment', 1, 'Superseeded by #2'], ['comment', 3, 'Superseeded by #4'],
    ['comment', 5, 'Superseeded by #6']
  ]);
});

test('standalone cleanup scans every merged-history page before changing PR state', async t => {
  const f = fixture();
  f.history.splice(0, f.history.length,
    ...Array.from({length: 100}, (_, i) => ({...mergedPr(300 + i, '26.0.0'), body: 'Manual change'})),
    mergedPr(200, '24.10.3'));
  await f.runAll();
  const historyEvents = f.events.filter(event => event[0] === 'history');
  t.deepEqual(historyEvents, [['history', 1], ['history', 2]]);
  t.true(f.events.findIndex(event => event[0] === 'comment') > f.events.findIndex(event => event[0] === 'history' && event[1] === 2));
  t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'open']);
});

for (const mismatch of ['unmerged', 'fork', 'base', 'marker']) {
  test(`a ${mismatch} historical PR cannot become a standalone replacement`, async t => {
    const f = fixture();
    f.candidates.splice(0, f.candidates.length, pr(1, '22.1.0'));
    if (mismatch === 'unmerged') f.replacement.merged_at = null;
    if (mismatch === 'fork') f.replacement.head.repo.full_name = 'fork/repo';
    if (mismatch === 'base') f.replacement.base.ref = 'develop';
    if (mismatch === 'marker') f.replacement.body = 'Manual bump';
    await f.runAll();
    t.is(f.candidates[0].state, 'open');
    t.false(f.events.some(event => ['comment', 'close'].includes(event[0])));
  });
}

test('standalone cleanup does not read history when there are no eligible open PRs', async t => {
  const f = fixture();
  f.candidates.forEach(item => { item.body = 'Manual PR'; });
  await f.runAll();
  t.deepEqual(f.events, [['list', 1]]);
});

test('standalone cleanup leaves forks and manual branches untouched', async t => {
  const f = fixture();
  f.history.length = 0;
  f.candidates[1] = pr(2, '22.4.0');
  f.candidates.push({...pr(4, '22.0.0'), head: {...pr(4, '22.0.0').head, repo: {full_name: 'fork/repo'}}});
  f.candidates.push({...pr(5, '22.0.0'), head: {...pr(5, '22.0.0').head, ref: 'manual'}});
  await f.runAll();
  t.false(f.events.some(event => ['comment', 'close'].includes(event[0]) && [4, 5].includes(event[1])));
  t.deepEqual(f.candidates.map(item => item.state), ['open', 'closed', 'open', 'open', 'open']);
});

for (const mode of ['run', 'runAll']) {
  test(`${mode} cleans generated PRs regardless of authenticated or PR authors`, async t => {
    const f = fixture({login: 'personal-account'});
    f.replacement.user.login = 'release-bot';
    f.candidates[0].user.login = 'old-bot';
    f.candidates[1].user.login = 'another-bot';
    await f[mode]();
    t.deepEqual(f.candidates.map(item => item.state), ['closed', 'closed', 'open']);
  });
}

test('unavailable merged history does not cause speculative standalone closures', async t => {
  const f = fixture({failHistory: true});
  f.candidates.push(pr(4, '26.2.0'));
  await t.notThrowsAsync(f.runAll());
  t.false(f.events.some(event => ['comment', 'close'].includes(event[0])));
});

for (const local of [true, false]) {
  test(`standalone cleanup skips GitHub with ${local ? 'local mode' : 'no token'}`, async t => {
    const f = fixture();
    if (local) f.config.local = true;
    else delete f.config.token;
    await f.runAll();
    t.deepEqual(f.events, []);
  });
}
