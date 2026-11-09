const {mkdtemp, writeFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const test = require('ava').default;
const {execa, execaSync} = require('execa');
const {createNodeUpgradeTarget, nodeUpgradeBranch, nodeUpgradeMarker} = require('../src/core/node-pull-requests');

const modules = {
  got: require.resolve('got'), git: require.resolve('../src/core/git'),
  script: require.resolve('../src/core/script'), bump: require.resolve('../src/bump-version')
};

const autobump = async (t, options = {}) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'autobump-cleanup-'));
  t.teardown(() => rm(cwd, {recursive: true, force: true}));
  const git = (...args) => execaSync('git', args, {cwd}).stdout;
  const target = createNodeUpgradeTarget('24.10.3', 'api');
  const previous = createNodeUpgradeTarget('22.23.0', 'api');
  const makePr = (number, upgrade) => ({
    number, state: 'open', user: {login: 'bot'}, body: nodeUpgradeMarker(upgrade),
    base: {ref: 'master', repo: {full_name: 'org/repo'}},
    head: {ref: nodeUpgradeBranch(upgrade), repo: {full_name: 'org/repo', owner: {login: 'org'}}}
  });
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({name: 'autobump-fixture', version: '1.0.0'}));
  git('init', '--initial-branch=master');
  git('config', 'user.name', 'Autobump Test');
  git('config', 'user.email', 'test@example.com');
  git('add', '.');
  git('commit', '-m', 'Upgrade Node to v24.10.3');
  const mergedSha = git('rev-parse', 'HEAD');
  if (options.summary) git('commit', '--allow-empty', '-m', 'Upgrade Node (#200)\n\nMerge pull request #200 from org/update-node-api-v24.10');
  const originalHead = git('rev-parse', 'HEAD');
  const replacement = {
    ...makePr(200, target), state: 'closed', merge_commit_sha: mergedSha, merged_at: '2026-11-09T12:00:00Z'
  };
  const oldPr = makePr(1, previous);
  const result = await execa(process.execPath, ['-e', `
    const cp = require('child_process');
    const modules = ${JSON.stringify(modules)};
    const options = ${JSON.stringify(options)};
    const replacement = ${JSON.stringify(replacement)};
    const oldPr = ${JSON.stringify(oldPr)};
    const events = [];
    const request = async url => {
      events.push(['get', url]);
      if (options.lookupFailure) throw new Error('GitHub lookup unavailable');
      if (url.includes('/commits/')) return {body: options.summary ? [] : [replacement]};
      if (url.endsWith('/pulls/200')) return {body: replacement};
      if (url.endsWith('/user')) return {body: {login: 'bot'}};
      if (url.endsWith('/comments')) return {body: []};
      return {body: [oldPr]};
    };
    request.post = async (url, config) => {
      events.push(['comment', config.json.body]);
      if (options.commentFailure) throw new Error('GitHub comment unavailable');
    };
    request.patch = async () => events.push(['close']);
    require(modules.got);
    require.cache[modules.got].exports = {default: request};
    require(modules.script).executeScript = async commands => {
      for (const command of commands) {
        if (command.startsWith('npm version')) {
          events.push(['bump']);
          cp.execFileSync('npm', ['version', '-m', 'v%s', 'minor'], {stdio: 'pipe'});
        } else if (command === 'npm publish') events.push(['publish']);
        else throw new Error('Unexpected command');
      }
    };
    require(modules.git).pushFiles = async () => events.push(['push']);
    const config = {
      repoSlug: 'org/repo', baseBranch: 'master', token: 'fake', local: options.local,
      'auto-bump': {keywords: options.noop ? {noop: true} : {minor: true}, publish: true}
    };
    require(modules.bump).main(config)
      .then(() => console.log('RESULT:' + JSON.stringify({events, version: require('./package.json').version})))
      .catch(error => {console.error(error); process.exitCode = 1;});
  `], {cwd, reject: false});
  t.is(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout.split('RESULT:')[1]);
  return {...output, stderr: result.stderr, originalHead, git};
};

for (const summary of [false, true]) {
  test.serial(`autobump cleans up ${summary ? 'a fast-forward summary' : 'a merged Node PR'} before its real version commit`, async t => {
    const result = await autobump(t, {summary});
    t.deepEqual(result.events.filter(event => event[0] !== 'get'), [
      ['comment', 'Superseeded by #200'], ['close'], ['bump'], ['push'], ['publish']
    ]);
    t.is(result.version, '1.1.0');
    t.is(result.git('rev-parse', 'HEAD^'), result.originalHead);
    t.is(result.git('log', '-1', '--format=%s'), 'v1.1.0');
  });
}

for (const failure of ['lookupFailure', 'commentFailure']) {
  test.serial(`autobump still bumps, pushes and publishes after ${failure}`, async t => {
    const result = await autobump(t, {[failure]: true});
    t.regex(result.stderr, /Warning: Could not/);
    t.deepEqual(result.events.filter(event => ['bump', 'push', 'publish'].includes(event[0])), [
      ['bump'], ['push'], ['publish']
    ]);
    t.false(result.events.some(event => event[0] === 'close'));
    t.is(result.version, '1.1.0');
  });
}

test.serial('a no-op release still cleans up a merged Node upgrade without creating a version commit', async t => {
  const result = await autobump(t, {noop: true});
  t.deepEqual(result.events.filter(event => event[0] !== 'get'), [['comment', 'Superseeded by #200'], ['close']]);
  t.is(result.version, '1.0.0');
  t.is(result.git('rev-parse', 'HEAD'), result.originalHead);
});

test.serial('local autobump performs no GitHub cleanup', async t => {
  const result = await autobump(t, {local: true});
  t.false(result.events.some(event => ['get', 'comment', 'close', 'push'].includes(event[0])));
  t.is(result.version, '1.1.0');
});
