const {execFile} = require('child_process');
const {mkdtemp, writeFile, readFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const {promisify} = require('util');
const test = require('ava').default;

const exec = promisify(execFile);
const bump = require.resolve('../src/bump-dependencies');
const versions = require.resolve('../src/core/node');
const git = require.resolve('../src/core/git');

const cases = [
  {
    name: '--exact uses the resolved option and removes range prefixes',
    resolved: {exact: true},
    node: {exact: false},
    expected: {node: '24.10.3', npm: '11.6.0'}
  },
  {
    name: '--no-loose uses the resolved option and preserves range prefixes',
    resolved: {loose: false},
    node: {loose: true},
    expected: {node: '^24.10.3', npm: '~11.6.0'}
  },
  {
    name: 'an explicitly resolved false overrides a nested true',
    resolved: {exact: false},
    node: {exact: true},
    expected: {node: '>=24.10.3', npm: '>=11.6.0'}
  },
  {
    name: 'direct config callers retain nested exact settings',
    resolved: {},
    node: {exact: true},
    expected: {node: '24.10.3', npm: '11.6.0'}
  },
  {
    name: 'direct config callers retain nested loose settings',
    resolved: {},
    node: {loose: false},
    expected: {node: '^24.10.3', npm: '~11.6.0'}
  },
  {
    name: 'omitted options default to loose engine ranges',
    resolved: {},
    node: {},
    expected: {node: '>=24.10.3', npm: '>=11.6.0'}
  }
];

for (const {name, resolved, node, expected} of cases) {
  test(name, async t => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'node-engine-options-'));
    t.teardown(() => rm(cwd, {recursive: true, force: true}));
    await writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({engines: {node: '^22.0.0', npm: '~10.0.0'}})
    );
    await exec(process.execPath, [
      '-e',
      `require(${JSON.stringify(versions)}).findLatest = async () => ({version: 'v24.10.3', npm: '11.6.0'});
      require(${JSON.stringify(git)}).commitFiles = async () => {};
      require(${JSON.stringify(bump)})({
        ...${JSON.stringify(resolved)},
        node: {...${JSON.stringify(node)}, package: ${JSON.stringify(path.join(cwd, 'package.json'))}},
        local: true, baseBranch: 'master', argv: {syncLock: false}
      }, {onlyNodeVersion: true}).catch(error => { console.error(error); process.exitCode = 1; });`
    ]);
    const contents = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
    t.deepEqual(contents.engines, expected);
  });
}
