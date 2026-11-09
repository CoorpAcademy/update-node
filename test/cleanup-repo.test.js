const {execFile} = require('child_process');
const {mkdtemp, writeFile, readdir, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const {promisify} = require('util');
const test = require('ava').default;

const exec = promisify(execFile);
const cli = require.resolve('../bin/update-node.js');

const fixture = async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'update-node-remote-'));
  t.teardown(() => rm(cwd, {recursive: true, force: true}));
  const preload = path.join(cwd, 'preload.cjs');
  await writeFile(preload, String.raw`
    const assert = require('assert/strict');
    const events = [];
    const execaPath = ${JSON.stringify(require.resolve('execa'))};
    const original = require(execaPath);
    require.cache[execaPath].exports = {
      ...original,
      execa: async (command, args) => {
        assert.equal(command, 'gh');
        assert.deepEqual(args, ['auth', 'token']);
        events.push('auth');
        return {stdout: 'fake'};
      },
      execaSync: () => { throw new Error('Must not invoke local Git'); }
    };
    const repo = 'https://api.github.com/repos/other/remote';
    const pr = (number, minor, state) => ({
      number, state, user: {login: state === 'closed' ? 'release-bot' : 'old-bot'},
      merged_at: state === 'closed' ? '2026-11-01T00:00:00Z' : null,
      body: '<!-- update-node: ' + JSON.stringify({major: 22, minor, scope: '', prefix: 'update-node'}) + ' -->',
      head: {ref: 'update-node-v22.' + minor, repo: {full_name: 'other/remote'}},
      base: {ref: 'main', repo: {full_name: 'other/remote'}}
    });
    const request = async (url, options) => {
      assert.equal(options.headers.Authorization, 'token fake');
      events.push(url);
      if (url === repo) return {body: {full_name: 'other/remote', default_branch: 'main'}};
      if (url.endsWith('/user')) return {body: {login: 'bot'}};
      if (url === repo + '/pulls') {
        assert.equal(options.searchParams.base, 'main');
        if (process.env.CLEANUP_EMPTY === '1') return {body: []};
        if (process.env.CLEANUP_CURRENT === '1')
          return {body: options.searchParams.state === 'open' ? [pr(100, 3, 'open')] : []};
        if (process.env.CLEANUP_LEGACY === '1') {
          const older = {
            ...pr(1, 13, 'open'), title: 'Upgrade Node to v26.13.0',
            body: ':rocket: Upgraded Node version to v26.13.0',
            head: {ref: 'update-node-v26.13.0', repo: {full_name: 'other/remote'}}
          };
          const newer = {
            ...pr(100, 13, 'open'), title: older.title,
            body: '<!-- update-node: {"major":26,"minor":13,"scope":"","prefix":"upgrade-node"} -->',
            head: {ref: 'upgrade-node-v26.13', repo: {full_name: 'other/remote'}}
          };
          return {body: options.searchParams.state === 'open' ? [older, newer] : []};
        }
        return {body: options.searchParams.state === 'open'
          ? [pr(1, 1, 'open'), pr(2, 2, 'open')] : [pr(100, 3, 'closed')]};
      }
      if (/\/issues\/[12]\/comments$/.test(url)) return {body: []};
      throw new Error('Unexpected request ' + url);
    };
    request.post = async (url, options) => {
      assert.equal(options.headers.Authorization, 'token fake');
      assert.equal(options.json.body, 'Superseeded by #100');
      events.push({comment: url});
    };
    request.patch = async (url, options) => {
      assert.equal(options.headers.Authorization, 'token fake');
      assert.equal(options.json.state, 'closed');
      events.push({close: url});
    };
    const gotPath = ${JSON.stringify(require.resolve('got'))};
    require(gotPath);
    require.cache[gotPath].exports = {default: request};
    process.on('exit', () => console.log('RESULT:' + JSON.stringify(events)));
  `);
  return {cwd, preload};
};

for (const auth of ['--token', '--auto-token']) {
  test(`repo override cleans PRs from a folder without a checkout using ${auth}`, async t => {
    const {cwd, preload} = await fixture(t);
    const before = await readdir(cwd);
    const {stdout, stderr} = await exec(process.execPath, [
      '-r', preload, cli, 'cleanup-prs', '--repo', 'other/remote',
      '--config', path.join(cwd, 'missing.json'), auth, ...(auth === '--token' ? ['fake'] : [])
    ], {cwd});
    t.is(stderr, '');
    const events = JSON.parse(stdout.split('RESULT:')[1]);
    t.deepEqual(events.filter(event => event.close), [
      {close: 'https://api.github.com/repos/other/remote/pulls/1'},
      {close: 'https://api.github.com/repos/other/remote/pulls/2'}
    ]);
    t.is(events.includes('auth'), auth === '--auto-token');
    t.regex(stdout, /Cleanup complete: 2 PRs closed, 0 kept, 0 failed/);
    t.deepEqual(await readdir(cwd), before);
  });
}

test('local repo override skips authentication and GitHub without a checkout', async t => {
  const {cwd, preload} = await fixture(t);
  const {stdout} = await exec(process.execPath, [
    '-r', preload, cli, 'cleanup-prs', '--repo', 'other/remote', '--local', '--auto-token'
  ], {cwd});
  t.deepEqual(JSON.parse(stdout.split('RESULT:')[1]), []);
});

test('cleanup explains when no eligible PRs match instead of silently exiting', async t => {
  const {cwd, preload} = await fixture(t);
  const {stdout} = await exec(process.execPath, [
    '-r', preload, cli, 'cleanup-prs', '--repo', 'other/remote', '--token', 'fake'
  ], {cwd, env: {...process.env, CLEANUP_EMPTY: '1'}});
  t.regex(stdout, /No eligible generated Node upgrade PRs/);
  t.regex(stdout, /other\/remote/);
  t.regex(stdout, /main/);
});

test('cleanup reports eligible PRs kept when none have a newer replacement', async t => {
  const {cwd, preload} = await fixture(t);
  const {stdout} = await exec(process.execPath, [
    '-r', preload, cli, 'cleanup-prs', '--repo', 'other/remote', '--token', 'fake'
  ], {cwd, env: {...process.env, CLEANUP_CURRENT: '1'}});
  t.regex(stdout, /Cleanup complete: 0 PRs closed, 1 kept, 0 failed/);
});

test('repo override cleans legacy patch branches in favor of their modern replacement', async t => {
  const {cwd, preload} = await fixture(t);
  const {stdout, stderr} = await exec(process.execPath, [
    '-r', preload, cli, 'cleanup-prs', '--repo', 'other/remote', '--token', 'fake'
  ], {cwd, env: {...process.env, CLEANUP_LEGACY: '1'}});
  t.is(stderr, '');
  t.regex(stdout, /Cleanup complete: 1 PRs closed, 1 kept, 0 failed/);
  const events = JSON.parse(stdout.split('RESULT:')[1]);
  t.deepEqual(events.filter(event => event.close), [
    {close: 'https://api.github.com/repos/other/remote/pulls/1'}
  ]);
});
