const test = require('ava').default;
const {execa} = require('execa');

const gitModule = require.resolve('../src/core/git');
const scriptModule = require.resolve('../src/core/script');
const gotModule = require.resolve('got');
const bumpModule = require.resolve('../src/bump-version');
const token = 'ghp_testToken123';

const authenticate = async operation => {
  const {stdout} = await execa(process.execPath, ['-e', `
    const requests = [];
    const scripts = [];
    require(${JSON.stringify(gotModule)});
    require.cache[${JSON.stringify(gotModule)}].exports = {default: url => {
      requests.push(url);
      throw new Error('Git authentication must not require an API lookup');
    }};
    if (${JSON.stringify(operation)} === 'push') {
      const execaPath = require.resolve('execa');
      const execa = require(execaPath);
      const original = execa.execaSync;
      require.cache[execaPath].exports = {...execa, execaSync: (command, args, options) => {
        if (args[0] === 'config' && args[1] === 'remote.gh.url') return {exitCode: 1, stdout: ''};
        if (args[0] === 'remote' && args[1] === 'get-url')
          return {exitCode: 0, stdout: 'https://github.com/org/repo.git'};
        if (args[0] === 'ls-remote') return {exitCode: 2, stdout: ''};
        return original(command, args, options);
      }};
    }
    require(${JSON.stringify(scriptModule)}).executeScript = async commands => scripts.push(commands);
    const git = require(${JSON.stringify(gitModule)});
    git.headClean = () => true;
    git.headMessage = () => 'Feature #minor';
    const config = {
      local: true, token: ${JSON.stringify(token)}, repoSlug: 'org/repo', forceFlag: '--force-with-lease',
      'auto-bump': {keywords: {minor: true}, ${JSON.stringify(operation + '-branch')}: 'release'}
    };
    const action = ${JSON.stringify(operation)} === 'push'
      ? git.pushFiles('feature', config.token, config.repoSlug, {tags: true})
      : require(${JSON.stringify(bumpModule)}).main(config);
    action.then(() => console.log('RESULT:' + JSON.stringify({requests, scripts})))
      .catch(error => console.log('RESULT:' + JSON.stringify({requests, scripts, error: error.message})));
  `]);
  return JSON.parse(stdout.split('RESULT:')[1]);
};

for (const operation of ['push', 'sync', 'merge']) {
  test(`${operation} uses the token as the remote password without an API lookup`, async t => {
    const {requests, scripts, error} = await authenticate(operation);
    t.is(error, undefined);
    t.deepEqual(requests, []);
    const commands = scripts.find(group => group.some(command => command.includes('git remote add gh')));
    t.truthy(commands);
    const remote = new URL(commands[0].split('git remote add gh ')[1]);
    t.is(remote.username, 'x-access-token');
    t.is(remote.password, token);
    t.is(remote.hostname, 'github.com');
    t.is(remote.pathname, '/org/repo.git');
    t.true(scripts.some(group => group.includes('git remote remove gh')));
    if (operation === 'push') {
      const pushCommand = scripts.flat().find(command => command.includes('git push gh feature:refs/heads/feature'));
      t.true(pushCommand.includes('--force-with-lease=refs/heads/feature:'));
      t.true(pushCommand.includes('git push gh --tags'));
    } else {
      t.true(commands.some(command => command.includes('refs/heads/release')));
    }
  });
}

test('script output and command errors redact remote credentials', async t => {
  const scriptModule = require.resolve('../src/core/script');
  const secret = 'credential-that-must-not-appear';
  const remote = `https://x-access-token:${secret}@github.com/org/repo.git`;
  const {stdout} = await execa(process.execPath, [
    '-e',
    `require(${JSON.stringify(scriptModule)}).executeScript(${JSON.stringify([
      `printf '%s\\n' '${remote}'`,
      `printf '%s\\n' '${remote}' >&2; exit 17`
    ])}).catch(error => console.log('ERROR:' + error.message))`
  ]);

  t.false(stdout.includes(secret));
  t.true(stdout.includes('<REDACTED>@github.com/org/repo.git'));
  t.regex(stdout, /ERROR:Command failed with exit code 17/);
});
