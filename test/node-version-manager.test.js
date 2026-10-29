const {mkdtemp, mkdir, writeFile, readFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const test = require('ava').default;
const {execa} = require('execa');

const runnerPath = require.resolve('../src/core/node-version-manager');
const bumpPath = require.resolve('../src/bump-dependencies');
const versionsPath = require.resolve('../src/core/node');
const gitPath = require.resolve('../src/core/git');

const fixture = async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'update-node-manager-'));
  t.teardown(() => rm(cwd, {recursive: true, force: true}));
  const bin = path.join(cwd, 'bin');
  const selected = path.join(cwd, 'selected');
  const nvm = path.join(cwd, 'nvm directory');
  await Promise.all([bin, selected, nvm].map(dir => mkdir(dir)));
  await writeFile(path.join(cwd, '.nvmrc'), 'v22.0.0\n');
  await writeFile(path.join(selected, 'node'), '#!/bin/sh\nprintf selected', {mode: 0o755});

  const env = {
    PATH: bin,
    HOME: cwd,
    NVM_DIR: nvm,
    SELECTED_BIN: selected,
    TRACE: path.join(cwd, 'trace')
  };
  return {
    cwd,
    nvm: script => writeFile(path.join(nvm, 'nvm.sh'), script),
    n: script => writeFile(path.join(bin, 'n'), `#!/bin/sh\n${script}`, {mode: 0o755}),
    read: file => readFile(path.join(cwd, file), 'utf8'),
    run: (commands = ['node > first', 'node > second'], version = null) =>
      execa(
        process.execPath,
        [
          '-e',
          `const {getNodeVersionRunner} = require(${JSON.stringify(runnerPath)});
          getNodeVersionRunner(${JSON.stringify(version)}).then(run => run(${JSON.stringify(commands)})).catch(err => {
            console.error(err.message);
            process.exitCode = err.exitCode || 2;
          });`
        ],
        {cwd, env, reject: false}
      ),
    bump: argv =>
      execa(
        process.execPath,
        [
          '-e',
          `require(${JSON.stringify(versionsPath)}).findLatest = async () => ({version: 'v22.9.0'});
          require(${JSON.stringify(gitPath)}).commitFiles = async () => {};
          const bump = require(${JSON.stringify(bumpPath)});
          bump({node: {nvmrc: '.nvmrc'}, local: true, baseBranch: 'master',
            packageManager: 'npm', argv: ${JSON.stringify(argv)}}, {onlyNodeVersion: true})
            .catch(err => { console.error(err.message); process.exitCode = err.exitCode || 2; });`
        ],
        {cwd, env, reject: false}
      )
  };
};

const nvmScript = `nvm() {
  printf '%s\\n' "$1" >> "$TRACE"
  export PATH="$SELECTED_BIN:$PATH"
}`;

test('prefers nvm and keeps the selected node for all commands', async t => {
  const f = await fixture(t);
  await f.nvm(nvmScript);
  await f.n('exit 99');
  const result = await f.run();
  t.is(result.exitCode, 0, `${result.stderr}`);
  t.is(await f.read('trace'), 'use\n');
  t.is(await f.read('first'), 'selected');
  t.is(await f.read('second'), 'selected');
});

test('installs with nvm when use fails and preserves the installed node', async t => {
  const f = await fixture(t);
  await f.nvm(`nvm() {
    printf '%s\\n' "$1" >> "$TRACE"
    if [ "$1" = use ]; then return 3; fi
    export PATH="$SELECTED_BIN:$PATH"
  }`);
  const result = await f.run();
  t.is(result.exitCode, 0, `${result.stderr}`);
  t.is(await f.read('trace'), 'use\ninstall\n');
  t.is(await f.read('second'), 'selected');
});

test('lock sync and precommit commands use the updated node version', async t => {
  const f = await fixture(t);
  await f.nvm(`nvm() {
    read version < .nvmrc
    printf '%s' "$version" > "$TRACE"
    export PATH="$SELECTED_BIN:$PATH"
  }`);
  await writeFile(path.join(f.cwd, 'bin', 'npm'), '#!/bin/sh\nnode > first', {mode: 0o755});
  const result = await f.bump({syncLock: true, preCommitBumpCommand: ['node > second']});
  t.is(result.exitCode, 0, `${result.stderr}`);
  t.is(await f.read('trace'), 'v22.9.0');
  t.is(await f.read('first'), 'selected');
  t.is(await f.read('second'), 'selected');
});

test('falls back to n when nvm is absent', async t => {
  const f = await fixture(t);
  await f.n('printf "%s" "$1" > "$TRACE"');
  const result = await f.run(['printf done > first']);
  t.is(result.exitCode, 0, `${result.stderr}`);
  t.is(await f.read('trace'), 'auto');
  t.is(await f.read('first'), 'done');
});

test('falls back to n when the sourced file does not define nvm', async t => {
  const f = await fixture(t);
  await f.nvm(':');
  await f.n('printf "%s" "$1" > "$TRACE"');
  const result = await f.run([]);
  t.is(result.exitCode, 0, `${result.stderr}`);
  t.is(await f.read('trace'), 'auto');
});

test('reports missing managers before changing node version files', async t => {
  const f = await fixture(t);
  const result = await f.bump({syncLock: true});
  t.is(result.exitCode, 2);
  t.regex(result.stderr, /(?:^|\n)No node version manager was found$/);
  t.is(await f.read('.nvmrc'), 'v22.0.0\n');
});

test('does not require a manager when no activation commands are requested', async t => {
  const f = await fixture(t);
  const result = await f.bump({syncLock: false});
  t.is(result.exitCode, 0, `${result.stderr}`);
  t.is(await f.read('.nvmrc'), 'v22.9.0\n');
});

test('requires a manager for precommit commands even with lock sync disabled', async t => {
  const f = await fixture(t);
  const result = await f.bump({syncLock: false, preCommitBumpCommand: ['printf done']});
  t.is(result.exitCode, 2);
  t.regex(result.stderr, /(?:^|\n)No node version manager was found$/);
  t.is(await f.read('.nvmrc'), 'v22.0.0\n');
});

test('does not fall back to n when nvm installation fails', async t => {
  const f = await fixture(t);
  await f.nvm('nvm() { echo "nvm failed" >&2; return 42; }');
  await f.n('printf unexpected > "$TRACE"');
  const result = await f.run(['printf unexpected > first']);
  t.is(result.exitCode, 42);
  t.true(result.stderr.includes('nvm failed'));
  await t.throwsAsync(f.read('trace'), {code: 'ENOENT'});
  await t.throwsAsync(f.read('first'), {code: 'ENOENT'});
});

test('preserves n activation failures', async t => {
  const f = await fixture(t);
  await f.n('echo "n failed" >&2; exit 43');
  const result = await f.run(['printf unexpected > first']);
  t.is(result.exitCode, 43);
  t.true(result.stderr.includes('n failed'));
  await t.throwsAsync(f.read('first'), {code: 'ENOENT'});
});

test('does not fall back when sourcing nvm fails', async t => {
  const f = await fixture(t);
  await f.nvm('return 44');
  await f.n('printf unexpected > "$TRACE"');
  const result = await f.run();
  t.is(result.exitCode, 44);
  await t.throwsAsync(f.read('trace'), {code: 'ENOENT'});
});

test('stops before later commands when a dependent command fails', async t => {
  const f = await fixture(t);
  await f.nvm(nvmScript);
  const result = await f.run(['exit 45', 'printf unexpected > second']);
  t.is(result.exitCode, 45);
  await t.throwsAsync(f.read('second'), {code: 'ENOENT'});
});

test('explicit nvm targets override an older version pin', async t => {
  const f = await fixture(t);
  await f.nvm(`nvm() {
    printf '%s' "$*" > "$TRACE"
    export PATH="$SELECTED_BIN:$PATH"
  }`);
  const result = await f.run(['node > first'], '24.10.3');
  t.is(result.exitCode, 0, result.stderr);
  t.is(await f.read('trace'), 'use 24.10.3');
  t.is(await f.read('first'), 'selected');
});

test('explicit n targets install the selected full release', async t => {
  const f = await fixture(t);
  await f.n('printf "%s" "$*" > "$TRACE"');
  const result = await f.run([], '24.10.3');
  t.is(result.exitCode, 0, result.stderr);
  t.is(await f.read('trace'), '24.10.3');
});
