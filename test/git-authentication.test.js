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
    t.is(commands.at(-1), 'git remote remove gh');
    if (operation === 'push') {
      t.true(commands[1].includes('git push gh feature:refs/heads/feature --force-with-lease'));
      t.true(commands[1].includes('git push gh --tags'));
    } else {
      t.true(commands.some(command => command.includes('refs/heads/release')));
    }
  });
}
