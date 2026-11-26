const test = require('ava').default;
const {mkdtemp, rm, writeFile} = require('fs/promises');
const os = require('os');
const path = require('path');
const {execa} = require('execa');
const gitModule = path.resolve(__dirname, '../src/core/git.js');

const git = (cwd, ...args) => execa('git', args, {cwd});
const push = (client, branch, forceFlag = '--force-with-lease') =>
  execa(process.execPath, [
    '-e',
    `require(${JSON.stringify(gitModule)}).pushFiles(${JSON.stringify(branch)}, 'unused', 'org/repo', {forceFlag: ${JSON.stringify(forceFlag)}, tags: ${JSON.stringify(forceFlag === '--force')}}).catch(error => { console.error(error.message); process.exitCode = 1; })`
  ], {cwd: client});
const remoteTip = async (remote, branch) =>
  (await execa('git', ['ls-remote', remote, `refs/heads/${branch}`])).stdout.split('\t')[0];

const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-node-push-'));
  const remote = path.join(directory, 'remote.git');
  const client = path.join(directory, 'client');
  await execa('git', ['init', '--bare', remote]);
  await execa('git', ['init', '-b', 'master', client]);
  await git(client, 'config', 'user.name', 'Fixture');
  await git(client, 'config', 'user.email', 'fixture@example.invalid');
  await git(client, 'commit', '--allow-empty', '-m', 'base');
  await git(client, 'remote', 'add', 'origin', remote);
  await git(client, 'remote', 'add', 'gh', remote);
  return {directory, remote, client};
};

test.serial('pushFiles publishes a branch when the destination ref is absent', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  await git(f.client, 'checkout', '-b', branch);

  await push(f.client, branch);

  t.is(await remoteTip(f.remote, branch), (await git(f.client, 'rev-parse', 'HEAD')).stdout);
});

test.serial('pushFiles refreshes an existing generated branch from a fresh destination view', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  await git(f.client, 'push', 'gh', `HEAD:refs/heads/${branch}`);
  await git(f.client, 'checkout', '-b', branch);
  await git(f.client, 'update-ref', '-d', `refs/remotes/gh/${branch}`);
  await git(f.client, 'commit', '--allow-empty', '-m', 'refresh');

  await t.notThrowsAsync(() => push(f.client, branch));

  t.is(await remoteTip(f.remote, branch), (await git(f.client, 'rev-parse', 'HEAD')).stdout);
});

test.serial('pushFiles leases the configured push URL instead of the fetch URL', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  const pushRemote = path.join(f.directory, 'push.git');
  await execa('git', ['init', '--bare', pushRemote]);
  await git(f.client, 'push', 'gh', `HEAD:refs/heads/${branch}`);
  await git(f.client, 'remote', 'set-url', '--push', 'gh', pushRemote);
  await git(f.client, 'push', 'gh', `HEAD:refs/heads/${branch}`);
  await git(f.client, 'checkout', '-b', branch);
  await git(f.client, 'commit', '--allow-empty', '-m', 'generated refresh');
  const fetchOnly = path.join(f.directory, 'fetch-only');
  await execa('git', ['clone', f.remote, fetchOnly]);
  await git(fetchOnly, 'config', 'user.name', 'Fixture');
  await git(fetchOnly, 'config', 'user.email', 'fixture@example.invalid');
  await git(fetchOnly, 'checkout', '-b', branch, `origin/${branch}`);
  await git(fetchOnly, 'commit', '--allow-empty', '-m', 'fetch destination advance');
  await git(fetchOnly, 'push', 'origin', `HEAD:refs/heads/${branch}`);

  await push(f.client, branch);

  t.is(await remoteTip(pushRemote, branch), (await git(f.client, 'rev-parse', 'HEAD')).stdout);
  t.is(await remoteTip(f.remote, branch), (await git(fetchOnly, 'rev-parse', 'HEAD')).stdout);
});

test.serial('pushFiles permits a non-fast-forward refresh when discarded commits match the generator', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  await git(f.client, 'push', 'gh', `HEAD:refs/heads/${branch}`);
  await git(f.client, 'checkout', '-b', branch);
  await git(f.client, 'update-ref', '-d', `refs/remotes/gh/${branch}`);
  await git(f.client, 'commit', '--allow-empty', '-m', 'candidate refresh');
  const other = path.join(f.directory, 'other');
  await execa('git', ['clone', f.remote, other]);
  await git(other, 'config', 'user.name', 'Fixture');
  await git(other, 'config', 'user.email', 'fixture@example.invalid');
  await git(other, 'checkout', '-b', branch, `origin/${branch}`);
  await git(other, 'commit', '--allow-empty', '-m', 'previous generated refresh');
  await git(other, 'push', 'origin', `HEAD:refs/heads/${branch}`);

  await push(f.client, branch);

  t.is(await remoteTip(f.remote, branch), (await git(f.client, 'rev-parse', 'HEAD')).stdout);
});

test.serial('pushFiles rejects a destination advance after its lease tip was read', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  await git(f.client, 'push', 'gh', `HEAD:refs/heads/${branch}`);
  await git(f.client, 'checkout', '-b', branch);
  await git(f.client, 'update-ref', '-d', `refs/remotes/gh/${branch}`);
  const other = path.join(f.directory, 'other');
  await execa('git', ['clone', f.remote, other]);
  await git(other, 'config', 'user.name', 'Fixture');
  await git(other, 'config', 'user.email', 'fixture@example.invalid');
  await git(other, 'checkout', '-b', branch, `origin/${branch}`);
  await git(other, 'commit', '--allow-empty', '-m', 'concurrent advance');
  const hookDir = path.join(f.client, '.git', 'hooks');
  const hook = `#!/bin/sh\ngit -C ${other} push origin HEAD:refs/heads/${branch}\n`;
  await writeFile(path.join(hookDir, 'pre-push'), hook, {mode: 0o755});
  await git(f.client, 'commit', '--allow-empty', '-m', 'refresh');

  await t.throwsAsync(() => push(f.client, branch));

  t.is(await remoteTip(f.remote, branch), (await git(other, 'rev-parse', 'HEAD')).stdout);
});

test.serial('pushFiles preserves remote commits authored by someone else', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  await git(f.client, 'push', 'gh', `HEAD:refs/heads/${branch}`);
  await git(f.client, 'checkout', '-b', branch);
  await git(f.client, 'update-ref', '-d', `refs/remotes/gh/${branch}`);
  await git(f.client, 'commit', '--allow-empty', '-m', 'generated refresh');
  const other = path.join(f.directory, 'other');
  await execa('git', ['clone', f.remote, other]);
  await git(other, 'config', 'user.name', 'Manual Editor');
  await git(other, 'config', 'user.email', 'manual@example.invalid');
  await git(other, 'checkout', '-b', branch, `origin/${branch}`);
  await git(other, 'commit', '--allow-empty', '-m', 'manual edit');
  await git(other, 'push', 'origin', `HEAD:refs/heads/${branch}`);
  const expected = await remoteTip(f.remote, branch);

  await t.throwsAsync(() => push(f.client, branch), {message: /other than the configured generator/});

  t.is(await remoteTip(f.remote, branch), expected);
});

test.serial('pushFiles fails closed when the destination tip cannot be read', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'upgrade-node-v24.22';
  await git(f.client, 'remote', 'set-url', 'gh', path.join(f.directory, 'missing.git'));
  await git(f.client, 'checkout', '-b', branch);

  await t.throwsAsync(() => push(f.client, branch), {message: /Could not read remote branch/});
});

test.serial('explicit force still pushes release branches and tags', async t => {
  const f = await fixture();
  t.teardown(() => rm(f.directory, {recursive: true, force: true}));
  const branch = 'release';
  await git(f.client, 'checkout', '-b', branch);
  await git(f.client, 'tag', 'v1.0.0');

  await push(f.client, branch, '--force');

  t.is(await remoteTip(f.remote, branch), (await git(f.client, 'rev-parse', 'HEAD')).stdout);
  t.is((await execa('git', ['--git-dir', f.remote, 'show-ref', '--tags', 'v1.0.0'])).stdout.split(' ')[1], 'refs/tags/v1.0.0');
});
