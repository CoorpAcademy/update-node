const {mkdtemp, writeFile, rm} = require('fs').promises;
const os = require('os');
const path = require('path');
const test = require('ava').default;
const {getConfig, validateConfig} = require('../src/core/config');

for (const preserveSameMajor of [true, false]) {
  test(`config files preserve node.preserveSameMajor=${preserveSameMajor}`, async t => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'node-config-'));
    t.teardown(() => rm(cwd, {recursive: true, force: true}));
    const config = path.join(cwd, '.update-node.json');
    await writeFile(path.join(cwd, 'package.json'), JSON.stringify({engines: {node: '>=22'}}));
    await writeFile(
      config,
      JSON.stringify({
        repoSlug: 'org/repo',
        baseBranch: 'master',
        dependencies: [],
        node: {package: true, preserveSameMajor}
      })
    );
    const resolved = await getConfig({config, local: true});
    t.is(resolved.node.preserveSameMajor, preserveSameMajor);
  });
}

test('rejects invalid preserveSameMajor config values', t => {
  t.throws(
    () =>
      validateConfig({
        repoSlug: 'org/repo',
        baseBranch: 'master',
        dependencies: [],
        node: {preserveSameMajor: 'sometimes'}
      }),
    {message: /preserveSameMajor.*boolean/}
  );
});
