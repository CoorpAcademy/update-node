const {execFile} = require('child_process');
const {mkdtemp, writeFile, readFile, rm} = require('fs').promises;
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

const cliFixture = async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'update-node-cli-'));
  t.teardown(() => rm(cwd, {recursive: true, force: true}));
  const write = (file, content) => writeFile(path.join(cwd, file), content);
  const git = (...args) => exec('git', args, {cwd});
  await write('package.json', JSON.stringify({name: 'fixture', version: '1.0.0'}));
  await git('init', '--initial-branch=master');
  await git('config', 'user.name', 'CLI Test');
  await git('config', 'user.email', 'cli@example.com');
  await git('remote', 'add', 'origin', 'git@github.com:example/repo.git');
  return {cwd, write, git};
};

for (const scenario of [
  {name: 'missing command', args: [], code: 4, message: /No command was selected/},
  {name: 'unknown command', args: ['unknown'], code: 4, message: /Command unknown does not exist/},
  {name: 'missing authentication mode', args: ['upgrade'], code: 22, message: /without one of following options/},
  {name: 'missing validation config', args: ['validate'], code: 2, message: /Missing config to validate/},
  {name: 'invalid validation schema', args: ['validate', '--verbose'], config: {}, code: 1, message: /Config has no valid schema/}
]) {
  test.serial(`CLI reports ${scenario.name} with its exit code`, async t => {
    const f = await cliFixture(t);
    if (scenario.config) await f.write('.update-node.json', JSON.stringify(scenario.config));
    const error = await t.throwsAsync(exec(process.execPath, [cli, ...scenario.args], {cwd: f.cwd}));
    t.is(error.code, scenario.code);
    t.regex(error.stderr, scenario.message);
    if (scenario.config) t.regex(error.stderr, /scaffold-config\.js/);
  });
}

test.serial('setup detects repository defaults and refuses to overwrite an existing config', async t => {
  const f = await cliFixture(t);
  await f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  for (const file of ['yarn.lock', 'lerna.json', '.nvmrc', 'Dockerfile', '.travis.yml', 'serverless.yml'])
    await f.write(file, '');
  await exec(process.execPath, [cli, 'setup'], {cwd: f.cwd});
  const original = await readFile(path.join(f.cwd, '.update-node.json'), 'utf8');
  const config = JSON.parse(original);
  t.is(config.repoSlug, 'example/repo');
  t.is(config.baseBranch, 'main');
  t.is(config.packageManager, 'yarn');
  for (const key of ['nvmrc', 'dockerfile', 'travis', 'serverless', 'package', 'lerna']) t.true(config.node[key]);
  const error = await t.throwsAsync(exec(process.execPath, [cli, 'setup'], {cwd: f.cwd}));
  t.is(error.code, 3);
  t.regex(error.stderr, /already exist/);
  t.is(await readFile(path.join(f.cwd, '.update-node.json'), 'utf8'), original);
});

test.serial('the folder option resolves validation config inside the selected directory', async t => {
  const f = await cliFixture(t);
  await f.write('.update-node.json', JSON.stringify({repoSlug: 'example/repo', baseBranch: 'master', node: false, dependencies: []}));
  const {stdout} = await exec(process.execPath, [cli, 'validate', '--folder', f.cwd]);
  t.regex(stdout, /Running Update-Node in/);
  t.regex(stdout, /Given configuration is valid/);
});

for (const scenario of [
  {name: 'dirty checkout', branch: 'master', message: 'docs', dirty: true, command: 'warn-dirty'},
  {name: 'feature branch', branch: 'feature/test', message: 'docs', command: 'bump-dependencies'},
  {name: 'version commit', branch: 'master', message: 'v1.0.0', command: 'bump-dependencies'},
  {name: 'ordinary base commit', branch: 'master', message: 'docs', command: 'auto-bump'}
]) {
  test.serial(`automatic command selection handles a ${scenario.name}`, async t => {
    const f = await cliFixture(t);
    await f.write('.update-node.json', JSON.stringify({
      repoSlug: 'example/repo', baseBranch: 'master', node: false,
      dependencies: [], 'auto-bump': false
    }));
    await f.git('add', '.');
    await f.git('commit', '-m', scenario.message);
    if (scenario.branch !== 'master') await f.git('switch', '-c', scenario.branch);
    if (scenario.dirty) await f.write('package.json', '{"name":"dirty"}');
    if (scenario.dirty) {
      const error = await t.throwsAsync(exec(process.execPath, [cli, '--auto', '--local'], {cwd: f.cwd}));
      t.is(error.code, 6);
      t.regex(error.stderr, /State is currently dirty/);
      t.true(error.stdout.includes(scenario.command));
    } else {
      const {stdout} = await exec(process.execPath, [cli, '--auto', '--local'], {cwd: f.cwd});
      t.true(stdout.includes(`Decided to run the command ${scenario.command}`));
      if (scenario.command === 'auto-bump') t.regex(stdout, /Auto-bump is deactivated/);
      else t.regex(stdout, /Update-node run with success/);
    }
  });
}
