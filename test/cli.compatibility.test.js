const {execFile} = require('child_process');
const {mkdtemp, writeFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const {promisify} = require('util');
const test = require('ava').default;

const exec = promisify(execFile);
const cli = require.resolve('../bin/update-node.js');
const scriptModule = require.resolve('../src/core/script');

test('CLI help loads production dependencies and lists commands', async t => {
  const {stdout} = await exec(process.execPath, [cli, '--help']);
  t.regex(stdout, /bump-dependencies/);
  t.regex(stdout, /auto-bump/);
  t.regex(stdout, /validate/);
});

test('validate discovers configuration without an explicit path', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'update-node-config-'));
  t.teardown(() => rm(cwd, {recursive: true, force: true}));
  await writeFile(
    path.join(cwd, '.update-node.json'),
    JSON.stringify({repoSlug: 'example/repo', baseBranch: 'master', node: false, dependencies: []})
  );
  const {stdout} = await exec(process.execPath, [cli, 'validate'], {cwd});
  t.regex(stdout, /Given configuration is valid/);
});

test('shell commands preserve quoting and pipe stdout and stderr through formatting', async t => {
  const {stdout} = await exec(
    process.execPath,
    [
      '-e',
      `const {executeScript} = require(${JSON.stringify(scriptModule)});
      executeScript([\`printf '%s\\n' 'hello world'; printf '%s\\n' 'error line' >&2\`])
        .catch(err => { console.error(err); process.exitCode = 1; });`
    ],
    {env: {...process.env, FORCE_COLOR: '0'}}
  );
  t.true(stdout.includes('\n      hello world\n'));
  t.true(stdout.includes('\n      error line\n'));
});

test('a failed shell command stops subsequent commands and preserves its exit code', async t => {
  const {stdout} = await exec(process.execPath, [
    '-e',
    `const {executeScript} = require(${JSON.stringify(scriptModule)});
    executeScript(['exit 7', 'echo SHOULD_NOT_RUN'])
      .catch(err => console.log('EXIT_CODE=' + err.exitCode));`
  ]);
  t.regex(stdout, /EXIT_CODE=7/);
  t.false(stdout.includes('\n      SHOULD_NOT_RUN\n'));
});
