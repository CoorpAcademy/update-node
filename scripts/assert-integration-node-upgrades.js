const assert = require('node:assert/strict');
const {execa} = require('execa');
const semver = require('semver');
const YAML = require('yaml');
const {findSupportedVersions} = require('../src/core/node');

const git = async (...args) => (await execa('git', args)).stdout;
const jsonAt = async (ref, file) => JSON.parse(await git('show', `${ref}:${file}`));

const main = async () => {
  const base = process.argv[2];
  const original = await jsonAt(base, 'package.json');
  const minimum = semver.minVersion(original.engines.node);
  const versions = await findSupportedVersions(original.engines.node);
  assert.deepEqual(versions.map(release => semver.major(release.version)), [22, 24, 26],
    'The end-to-end test must prepare Node 22, 24 and 26');
  const branches = [];
  for (const release of versions) {
    const version = release.version.replace(/^v/, '');
    const branch = `upgrade-node-v${semver.major(version)}.${semver.minor(version)}`;
    branches.push(branch);
    assert.equal(await git('rev-parse', `${branch}^`), base, `${branch} has an independent base`);
    const pkg = await jsonAt(branch, 'package.json');
    const engines = semver.major(version) === minimum.major ? original.engines : {
      ...original.engines, node: `>=${version}`, npm: `>=${release.npm}`
    };
    assert.deepEqual(pkg.engines, engines, `${branch} engine minima`);
    assert.deepEqual(pkg.dependencies, original.dependencies, `${branch} excludes dependency upgrades`);
    assert.deepEqual(pkg.devDependencies, original.devDependencies);
    assert.deepEqual((await jsonAt(branch, 'package-lock.json')).packages[''].engines, engines);
    assert.equal(await git('show', `${branch}:.nvmrc`), `v${version}`);
    assert.equal(YAML.parse(await git('show', `${branch}:.travis.yml`)).node_js[0], version);
  }
  const actual = await git('branch', '--list', '--format=%(refname:short)', 'upgrade-node-*');
  assert.deepEqual(actual.split('\n').sort(), branches.sort());
  assert.equal(await git('branch', '--show-current'), 'master');
  assert.equal(await git('status', '--porcelain', '--untracked-files=no'), '');
  // Dependency clusters may commit onto master, but Node changes stay on their
  // alternatives and must not leak into the following auto-bump scenarios.
  assert.deepEqual((await jsonAt('HEAD', 'package.json')).engines, original.engines);
  assert.equal(await git('show', 'HEAD:.nvmrc'), await git('show', `${base}:.nvmrc`));
  assert.equal(await git('show', 'HEAD:.travis.yml'), await git('show', `${base}:.travis.yml`));
  console.log(`✓ End-to-end Node upgrade branches: ${branches.join(', ')}`);
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
