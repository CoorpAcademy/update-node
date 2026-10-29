const assert = require('node:assert/strict');
const {mkdtemp, writeFile, readFile, rm} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execa} = require('execa');
const semver = require('semver');
const {findSupportedVersions} = require('../src/core/node');

const cli = path.resolve(__dirname, '../bin/update-node.js');

const checkAlternatives = async (versions, preserveSameMajor) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'update-node-integration-'));
  const git = async (...args) => (await execa('git', args, {cwd})).stdout;
  const write = (file, content) => writeFile(path.join(cwd, file), content);
  const jsonAt = async (branch, file) => JSON.parse(await git('show', `${branch}:${file}`));
  const minimumMajor = semver.major(versions[0].version);
  const engines = {node: `>=${minimumMajor}.0.0`, npm: '>=10.0.0'};
  try {
    await write('package.json', JSON.stringify({
      name: 'node-upgrade-integration', version: '1.0.0', private: true, engines
    }));
    await write('secondary.json', JSON.stringify({engines: {node: engines.node}}));
    await write('.nvmrc', `v${minimumMajor}.0.0\n`);
    await write('.update-node.json', JSON.stringify({
      repoSlug: 'CoorpAcademy/update-node',
      baseBranch: 'master',
      packageManager: 'npm',
      dependencies: [],
      node: {
        branch: 'upgrade-node', package: ['package.json', 'secondary.json'],
        nvmrc: true, preserveSameMajor
      }
    }));
    // Like the existing integration fixture, emulate nvm without downloading
    // runtimes. Record the requested release for the real precommit command.
    await write('nvm.sh', 'nvm() { export UPDATE_NODE_TEST_VERSION="$2"; }\n');
    await git('init', '--initial-branch=master');
    await git('config', 'user.name', 'Update Node Integration');
    await git('config', 'user.email', 'update-node@example.com');
    await git('add', '.');
    await git('commit', '-m', 'Integration base');
    const base = await git('rev-parse', 'HEAD');
    await write('personal.txt', 'Keep this untracked file.\n');
    const {stdout} = await execa(process.execPath, [cli, 'upgrade', '--local', '--only-node', '--scope', 'integration',
      '--pre-commit-bump-command', 'printf "%s" "$UPDATE_NODE_TEST_VERSION" > .selected-node'], {
      cwd,
      env: {NVM_DIR: cwd, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_engine_strict: 'false'}
    });
    assert.match(stdout, /bumped node with success/);
    const expectedBranches = [];
    for (const release of versions) {
      const version = release.version.replace(/^v/, '');
      const branch = `upgrade-node-integration-v${semver.major(version)}.${semver.minor(version)}`;
      expectedBranches.push(branch);
      assert.equal(await git('rev-parse', `${branch}^`), base, `${branch} must start from the original base`);
      const expectedEngines = preserveSameMajor !== false && semver.major(version) === minimumMajor
        ? engines : {node: `>=${version}`, npm: `>=${release.npm}`};
      assert.deepEqual((await jsonAt(branch, 'package.json')).engines, expectedEngines);
      assert.deepEqual((await jsonAt(branch, 'secondary.json')).engines, {node: expectedEngines.node});
      assert.deepEqual((await jsonAt(branch, 'package-lock.json')).packages[''].engines, expectedEngines);
      assert.equal(await git('show', `${branch}:.nvmrc`), `v${version}`);
      assert.equal(await git('show', `${branch}:.selected-node`), version);
      assert.equal(await git('ls-tree', '--name-only', branch, 'personal.txt'), '');
    }
    const branches = await git('branch', '--list', '--format=%(refname:short)', 'upgrade-node-*');
    assert.deepEqual(branches.split('\n').sort(), expectedBranches.sort());
    assert.equal(await git('branch', '--show-current'), 'master');
    assert.equal(await git('rev-parse', 'HEAD'), base);
    assert.equal(await git('status', '--porcelain', '--untracked-files=no'), '');
    assert.equal(await readFile(path.join(cwd, 'personal.txt'), 'utf8'), 'Keep this untracked file.\n');
    console.log(`✓ Stable-major CLI upgrades (preserveSameMajor=${preserveSameMajor ?? 'default'}): ${expectedBranches.join(', ')}`);
  } finally {
    await rm(cwd, {recursive: true, force: true});
  }
};

const main = async () => {
  // Discover live releases once; selection details have separate unit coverage.
  // All upgrade execution below goes through the public CLI without module mocks.
  const versions = await findSupportedVersions('>=22.0.0');
  assert.ok(versions.length >= 2, 'Integration coverage needs at least two supported even Node majors');
  await checkAlternatives(versions);
  await checkAlternatives(versions, false);
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
