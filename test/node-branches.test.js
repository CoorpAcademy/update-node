const {mkdtemp, writeFile, readFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const test = require('ava').default;
const {execa, execaSync} = require('execa');
const {nodeUpgradeBase, onNodeBranch} = require('../src/core/node-branches');

const fixture = async (t, engines) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'node-branches-'));
  t.teardown(() => rm(cwd, {recursive: true, force: true}));
  const git = (...args) => execaSync('git', args, {cwd}).stdout;
  const write = (file, contents) => writeFile(path.join(cwd, file), contents);
  const read = file => readFile(path.join(cwd, file), 'utf8');
  git('init', '--initial-branch=master');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  await write(
    'package.json',
    `${JSON.stringify({name: 'fixture', engines: engines || {node: '>=22.12.0', npm: '>=10.0.0'}})}\n`
  );
  await write('.nvmrc', 'v22.12.0\n');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = nodeUpgradeBase('master', cwd);
  return {cwd, git, write, read, base};
};

test.serial(
  'each branch starts from the frozen base, commits new locks, and restores the original branch',
  async t => {
    const f = await fixture(t);
    await f.write('personal.txt', 'existing untracked');
    for (const version of ['24.10', '26.0']) {
      const result = await onNodeBranch(
        `node-${version}`,
        f.base,
        async () => {
          t.is(await f.read('.nvmrc'), 'v22.12.0\n');
          await f.write('.nvmrc', version);
          await f.write('package-lock.json', version);
          f.git('add', '.');
          return {message: `Node ${version}`};
        },
        f.cwd
      );
      t.is(f.git('branch', '--show-current'), 'master');
      t.is(f.git('rev-parse', `${result.commit}^`), f.base);
      t.is(f.git('show', `${result.commit}:package-lock.json`), version);
      t.is(await f.read('.nvmrc'), 'v22.12.0\n');
      t.is(await f.read('personal.txt'), 'existing untracked');
      t.false(f.git('ls-tree', '--name-only', result.commit).includes('personal.txt'));
    }
  }
);

test.serial('a failed preparation is cleaned, and the next branch can succeed', async t => {
  const f = await fixture(t);
  await t.throwsAsync(
    onNodeBranch(
      'bad',
      f.base,
      async () => {
        await f.write('.nvmrc', 'partial');
        await f.write('new-lock', 'partial');
        throw new Error('install failed');
      },
      f.cwd
    ),
    {message: 'install failed'}
  );
  t.is(f.git('branch', '--show-current'), 'master');
  t.is(f.git('status', '--porcelain'), '');
  const next = await onNodeBranch(
    'good',
    f.base,
    async () => {
      await f.write('.nvmrc', 'v26.0.0');
      return {message: 'success'};
    },
    f.cwd
  );
  t.truthy(next.commit);
});

test.serial(
  'no changes create no commit, detached HEAD is restored, and dirty trees are rejected',
  async t => {
    const f = await fixture(t);
    f.git('switch', '--detach', f.base);
    const result = await onNodeBranch(
      'noop',
      f.base,
      () => Promise.resolve({message: 'noop'}),
      f.cwd
    );
    t.is(result.commit, null);
    t.is(f.git('rev-parse', 'HEAD'), f.base);
    t.is(f.git('branch', '--show-current'), '');
    await f.write('.nvmrc', 'personal edit');
    await t.throwsAsync(
      onNodeBranch('unsafe', f.base, async () => {}, f.cwd),
      {message: /clean tracked/}
    );
    t.is(await f.read('.nvmrc'), 'personal edit');
  }
);

const modules = {
  versions: require.resolve('../src/core/node'),
  github: require.resolve('../src/core/github'),
  prs: require.resolve('../src/core/node-pull-requests'),
  manager: require.resolve('../src/core/node-version-manager'),
  bump: require.resolve('../src/bump-dependencies'),
  nvmrc: require.resolve('../src/updatees/nvmrc'),
  packages: require.resolve('../src/updatees/package')
};
const workflow = (f, options = {}) =>
  execa(
    process.execPath,
    [
      '-e',
      `
  const fs = require('fs');
  const paths = ${JSON.stringify(modules)};
  const options = ${JSON.stringify(options)};
  const versions = require(paths.versions);
  const events = [];
  versions.findSupportedVersions = async range => {
    events.push(['range', range]);
    return (options.versions || ['22.20.0', '24.10.3', '26.0.0']).map(v => ({version: 'v' + v, npm: '11.6.0'}));
  };
  versions.findLatest = async range => {
    events.push(['legacy', range]);
    return {version: 'v24.10.3', npm: '11.6.0'};
  };
  require(paths.manager).getNodeVersionRunner = async version => commands => {
    events.push(['commands', version, commands]);
    if (options.failVersion && options.failVersion === version) {
      fs.writeFileSync('package-lock.json', 'partial');
      throw new Error('lock failed');
    }
    fs.writeFileSync('package-lock.json', JSON.stringify({node: version}));
  };
  require(paths.github).publishGithub = async (config, details) => {
    events.push(['publish', details.branch]);
    if (options.failPublish === details.branch) throw new Error('push failed');
    return {...details, pullRequest: {number: 123, html_url: 'https://example.com/pr'}};
  };
  require(paths.prs).closeSupersededNodePullRequests = async (config, pr, target) => {
    events.push(['close', target.major]);
  };
  if (options.failWrite) {
    require(paths.packages).updatePackageEngines = async () => { throw new Error('write failed'); };
    require.cache[paths.nvmrc] = {exports: async version => {
      await new Promise(resolve => setTimeout(resolve, 100));
      fs.writeFileSync('.nvmrc', 'v' + version);
    }};
  }
  const config = {
    node: {package: options.packages || ['package.json'], nvmrc: ['.nvmrc'], preserveSameMajor: options.preserveSameMajor},
    package: 'package.json', packageContent: JSON.parse(fs.readFileSync('package.json')),
    local: !options.remote, baseBranch: 'master', packageManager: 'npm',
    node_range: options.range, exact: options.exact, loose: options.loose,
    dependencies: [], reviewers: [], teamReviewers: [],
    argv: {scope: 'api', syncLock: options.syncLock !== false, preCommitBumpCommand: options.noCommands ? [] : ['verify']}
  };
  require(paths.bump)(config, {onlyNodeVersion: true, nodeVersionOverride: options.target})
    .catch(error => { console.error(error.message); process.exitCode = 2; })
    .finally(() => console.log('EVENTS:' + JSON.stringify(events)));
`
    ],
    {cwd: f.cwd, reject: false}
  );
const events = result => JSON.parse(result.stdout.split('EVENTS:')[1].trim());
const pkgAt = (f, ref, file = 'package.json') => JSON.parse(f.git('show', `${ref}:${file}`));

test.serial(
  'full local workflow prepares independent alternatives with per-file minima and selected-runtime locks',
  async t => {
    const f = await fixture(t);
    await f.write('second.json', JSON.stringify({engines: {node: '>=24.1.0', npm: '^10.9.0'}}));
    f.git('add', 'second.json');
    f.git('commit', '-m', 'second package');
    const base = f.git('rev-parse', 'HEAD');
    const result = await workflow(f, {packages: ['package.json', 'second.json']});
    t.is(result.exitCode, 0, result.stderr);
    t.regex(result.stdout, /Skipping update-node-api-v22.20/);
    for (const version of ['24.10.3', '26.0.0']) {
      const branch = `update-node-api-v${version.split('.').slice(0, 2).join('.')}`;
      t.is(f.git('rev-parse', `${branch}^`), base);
      t.is(pkgAt(f, branch).engines.node, `>=${version}`);
      t.deepEqual(JSON.parse(f.git('show', `${branch}:package-lock.json`)), {node: version});
    }
    t.deepEqual(pkgAt(f, 'update-node-api-v24.10', 'second.json').engines, {
      node: '>=24.1.0',
      npm: '^10.9.0'
    });
    t.is(f.git('branch', '--show-current'), 'master');
    t.is(f.git('status', '--porcelain'), '');
  }
);

test.serial('same-major engines are preserved while pins and lockfiles refresh', async t => {
  const f = await fixture(t);
  const result = await workflow(f, {versions: ['22.20.0']});
  t.is(result.exitCode, 0, result.stderr);
  t.deepEqual(pkgAt(f, 'update-node-api-v22.20').engines, {node: '>=22.12.0', npm: '>=10.0.0'});
  t.is(f.git('show', 'update-node-api-v22.20:.nvmrc'), 'v22.20.0');
  t.deepEqual(events(result)[1], ['commands', '22.20.0', ['npm install', 'verify']]);
});

test.serial(
  'lock failure is rolled back, other majors continue, and the final result fails',
  async t => {
    const f = await fixture(t);
    const result = await workflow(f, {failVersion: '24.10.3'});
    t.is(result.exitCode, 2);
    t.regex(result.stderr, /Node upgrades failed: update-node-api-v24.10/);
    t.is(f.git('rev-parse', 'update-node-api-v24.10'), f.base);
    t.is(pkgAt(f, 'update-node-api-v26.0').engines.node, '>=26.0.0');
    t.is(f.git('status', '--porcelain'), '');
    t.is(f.git('branch', '--show-current'), 'master');
  }
);

test.serial(
  'publication failure never closes old PRs and does not prevent later publication',
  async t => {
    const f = await fixture(t);
    const result = await workflow(f, {remote: true, failPublish: 'update-node-api-v24.10'});
    t.is(result.exitCode, 2);
    t.deepEqual(
      events(result).filter(event => ['publish', 'close'].includes(event[0])),
      [
        ['publish', 'update-node-api-v22.20'],
        ['close', 22],
        ['publish', 'update-node-api-v24.10'],
        ['publish', 'update-node-api-v26.0'],
        ['close', 26]
      ]
    );
  }
);

test.serial('explicit targets stay on the legacy path and respect formatting flags', async t => {
  const f = await fixture(t);
  const result = await workflow(f, {target: '24', exact: true});
  t.is(result.exitCode, 0, result.stderr);
  t.deepEqual(events(result)[0], ['legacy', '24']);
  t.is(pkgAt(f, 'master').engines.node, '24.10.3');
});

test.serial(
  'effective ranges are passed through, and no-sync-lock still runs precommit commands',
  async t => {
    const f = await fixture(t);
    const result = await workflow(f, {range: '>=24 <26', versions: ['24.10.3'], syncLock: false});
    t.is(result.exitCode, 0, result.stderr);
    t.deepEqual(events(result).slice(0, 2), [
      ['range', '>=24 <26'],
      ['commands', '24.10.3', ['verify']]
    ]);
  }
);

test.serial('an unchanged candidate creates no commit or PR', async t => {
  const f = await fixture(t);
  const result = await workflow(f, {
    versions: ['22.12.0'],
    syncLock: false,
    noCommands: true,
    remote: true
  });
  t.is(result.exitCode, 0, result.stderr);
  t.is(f.git('rev-parse', 'update-node-api-v22.12'), f.base);
  t.deepEqual(events(result), [['range', '>=22.12.0']]);
  t.is(f.git('rev-parse', 'HEAD'), f.base);
});

test.serial('non-lower-bound ranges preserve legacy single-upgrade behavior', async t => {
  const f = await fixture(t, {node: '^22.12.0'});
  const result = await workflow(f);
  t.is(result.exitCode, 0, result.stderr);
  t.deepEqual(events(result)[0], ['legacy', '^22.12.0']);
  t.is(pkgAt(f, 'master').engines.node, '>=24.10.3');
});

test.serial(
  'all pending file writes settle before failure cleanup restores the checkout',
  async t => {
    const f = await fixture(t);
    const result = await workflow(f, {versions: ['24.10.3'], failWrite: true});
    t.is(result.exitCode, 2);
    t.regex(result.stdout, /write failed/);
    t.is(f.git('branch', '--show-current'), 'master');
    t.is(f.git('status', '--porcelain'), '');
    t.is(await f.read('.nvmrc'), 'v22.12.0\n');
  }
);

test.serial(
  'configured false raises same-major engines and still activates the selected runtime',
  async t => {
    const f = await fixture(t);
    const result = await workflow(f, {versions: ['22.20.0'], preserveSameMajor: false});
    t.is(result.exitCode, 0, result.stderr);
    t.deepEqual(pkgAt(f, 'update-node-api-v22.20').engines, {node: '>=22.20.0', npm: '>=11.6.0'});
    t.deepEqual(events(result)[1], ['commands', '22.20.0', ['npm install', 'verify']]);
  }
);

test.serial('configured true preserves same-major engines for an explicit target', async t => {
  const f = await fixture(t, {node: '>=24.1.0', npm: '^10.0.0'});
  const result = await workflow(f, {target: '24', preserveSameMajor: true});
  t.is(result.exitCode, 0, result.stderr);
  t.deepEqual(pkgAt(f, 'master').engines, {node: '>=24.1.0', npm: '^10.0.0'});
  t.is(f.git('show', 'master:.nvmrc'), 'v24.10.3');
});

test.serial(
  'an explicit target still raises same-major engines when the setting is omitted',
  async t => {
    const f = await fixture(t, {node: '>=24.1.0', npm: '^10.0.0'});
    const result = await workflow(f, {target: '24'});
    t.is(result.exitCode, 0, result.stderr);
    t.deepEqual(pkgAt(f, 'master').engines, {node: '>=24.10.3', npm: '>=11.6.0'});
  }
);
