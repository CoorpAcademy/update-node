const {mkdtemp, writeFile, readFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const test = require('ava').default;
const {findSupportedVersions, isLowerBoundRange} = require('../src/core/node');
const {updatePackageEngines} = require('../src/updatees/package');
const {
  createNodeUpgradeTarget,
  nodeUpgradeBranch,
  nodeUpgradeMarker,
  isSupersededNodePullRequest,
  closeSupersededNodePullRequests
} = require('../src/core/node-pull-requests');

const release = (version, extra = {}) =>
  Object.assign({version: `v${version}`, npm: '11.6.0'}, extra);
const schedule = {
  v20: {start: '2023-04-18', end: '2026-04-30'},
  v22: {start: '2024-04-24', end: '2027-04-30'},
  v24: {start: '2025-05-06', end: '2028-04-30'},
  v26: {start: '2026-04-21', end: '2029-04-30'},
  v28: {start: '2027-04-20', end: '2030-04-30'}
};
const select = (versions, extra = {}, range = '>=20') =>
  findSupportedVersions(
    range,
    Object.assign(
      {
        getVersions: () => Promise.resolve(versions),
        getSchedule: () => Promise.resolve(schedule),
        isAvailable: () => Promise.resolve(true),
        now: new Date('2026-10-27')
      },
      extra
    )
  );

test('selects the latest stable release per supported even major, including Current', async t => {
  const versions = await select([
    release('20.19.0'),
    release('21.0.0'),
    release('22.12.0'),
    release('22.20.0'),
    release('24.10.0'),
    release('26.0.0', {lts: false}),
    release('28.0.0'),
    release('26.1.0-rc.1'),
    release('26.2.0', {date: '2026-11-01'})
  ]);
  t.deepEqual(
    versions.map(v => v.version),
    ['v22.20.0', 'v24.10.0', 'v26.0.0']
  );
});

test('respects the effective range and falls back within the same major for Docker', async t => {
  const attempted = [];
  const versions = await select(
    [release('22.20.0'), release('24.10.0'), release('24.9.0'), release('26.0.0')],
    {
      isAvailable: version => {
        attempted.push(version);
        return version === '24.10.0'
          ? Promise.reject(new Error('missing Docker tag'))
          : Promise.resolve();
      }
    },
    '>=24 <26'
  );
  t.deepEqual(
    versions.map(v => v.version),
    ['v24.9.0']
  );
  t.deepEqual(attempted, ['24.10.0', '24.9.0']);
});

test('reports unavailable majors and continues to other majors', async t => {
  const skipped = [];
  const versions = await select([release('22.20.0'), release('24.10.0')], {
    isAvailable: version =>
      version.startsWith('22.') ? Promise.reject(new Error('missing')) : Promise.resolve(),
    onSkip: major => skipped.push(major)
  });
  t.deepEqual(skipped, [22]);
  t.deepEqual(
    versions.map(v => v.version),
    ['v24.10.0']
  );
});

test('only lower-bound ranges opt into alternatives', t => {
  for (const range of ['>=22', ' >= 22.12.0', '>=22 <26']) t.true(isLowerBoundRange(range));
  for (const range of ['^22', '~22', '22', '', '>=22 || ^20']) t.false(isLowerBoundRange(range));
});

const packageFixture = async (t, contents) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'node-engines-'));
  t.teardown(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'package.json');
  const original = `${JSON.stringify(contents)}\n`;
  await writeFile(file, original);
  return {file, original, read: () => readFile(file, 'utf8')};
};

test('same-major updates preserve Node/npm ranges and original file bytes', async t => {
  const f = await packageFixture(t, {engines: {node: '>=22.12.0', npm: '^10.0.0'}});
  await updatePackageEngines('22.20.0', '11.6.0', f.file, {preserveSameMajor: true});
  t.is(await f.read(), f.original);
});

test('new-major engines use the full release, only updating npm when present', async t => {
  const withNpm = await packageFixture(t, {engines: {node: '>=22.12.0', npm: '^10.0.0'}});
  const noNpm = await packageFixture(t, {engines: {node: '>=22.12.0'}});
  await updatePackageEngines('24.10.3', '11.6.0', [withNpm.file, noNpm.file], {
    preserveSameMajor: true
  });
  t.deepEqual(JSON.parse(await withNpm.read()).engines, {node: '>=24.10.3', npm: '>=11.6.0'});
  t.deepEqual(JSON.parse(await noNpm.read()).engines, {node: '>=24.10.3'});
});

test('exact and no-loose retain their intended version formatting', async t => {
  const exact = await packageFixture(t, {engines: {node: '^22.0.0', npm: '~10.0.0'}});
  const prefix = await packageFixture(t, {engines: {node: '^22.0.0', npm: '~10.0.0'}});
  await updatePackageEngines('24.10.3', '11.6.0', exact.file, {exact: true});
  await updatePackageEngines('24.10.3', '11.6.0', prefix.file, {loose: false});
  t.deepEqual(JSON.parse(await exact.read()).engines, {node: '24.10.3', npm: '11.6.0'});
  t.deepEqual(JSON.parse(await prefix.read()).engines, {node: '^24.10.3', npm: '~11.6.0'});
});

const target = createNodeUpgradeTarget('24.10.3', 'api');
const replacement = {number: 200, user: {login: 'bot'}};
const oldPr = (id = 1) => ({
  number: id,
  state: 'open',
  user: {login: 'bot'},
  body: nodeUpgradeMarker(createNodeUpgradeTarget('24.9.1', 'api')),
  head: {ref: 'update-node-api-v24.9', repo: {full_name: 'org/repo'}},
  base: {ref: 'master'}
});
const superseded = pr =>
  isSupersededNodePullRequest(pr, replacement, target, 'org/repo', 'master', 'bot');

test('branch names reuse patches and preserve scope, major and minor', t => {
  t.is(nodeUpgradeBranch(target), 'update-node-api-v24.10');
  t.is(nodeUpgradeBranch(createNodeUpgradeTarget('24.10.9', 'api')), nodeUpgradeBranch(target));
});

test('only older generated PRs for the same author, repo, base, scope and major are superseded', t => {
  t.true(superseded(oldPr()));
  for (const modified of [
    {...oldPr(), number: 200},
    {...oldPr(), state: 'closed'},
    {...oldPr(), body: 'manual PR'},
    {...oldPr(), body: '<!-- update-node: broken -->'},
    {...oldPr(), user: {login: 'human'}},
    {...oldPr(), base: {ref: 'other'}},
    {...oldPr(), head: {ref: 'update-node-api-v24.9', repo: {full_name: 'fork/repo'}}},
    {...oldPr(), head: {ref: 'manual', repo: {full_name: 'org/repo'}}},
    ...['22.9.1', '24.10.1', '24.11.0'].map(v => ({
      ...oldPr(),
      body: nodeUpgradeMarker(createNodeUpgradeTarget(v, 'api'))
    })),
    {...oldPr(), body: nodeUpgradeMarker(createNodeUpgradeTarget('24.9.1', 'web'))}
  ])
    t.false(superseded(modified));
});

test('lists all open PR pages before closing any to avoid pagination skips', async t => {
  const events = [];
  const request = (url, options) => {
    if (url.endsWith('/user')) return Promise.resolve({body: {login: 'bot'}});
    const page = options.searchParams.page;
    events.push(`list ${page}`);
    return Promise.resolve({
      body:
        page === 1
          ? Array.from({length: 100}, (_, i) => ({
              ...oldPr(i + 1),
              body: i ? 'manual' : oldPr().body
            }))
          : [oldPr(101)]
    });
  };
  request.patch = url => {
    events.push(`close ${url.split('/').pop()}`);
    return Promise.resolve();
  };
  await closeSupersededNodePullRequests(
    {repoSlug: 'org/repo', baseBranch: 'master', token: 'fake'},
    replacement,
    target,
    request
  );
  t.deepEqual(events.slice(0, 3), ['list 1', 'list 2', 'close 1']);
  t.is(events.at(-1), 'close 101');
  t.is(events.length, 4);
});
