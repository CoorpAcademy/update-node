const {
  promises: {readFile, writeFile}
} = require('fs');
const path = require('path');
const c = require('chalk').default;
const {minimatch} = require('minimatch');
const _ = require('lodash/fp');
const pReduce = require('p-reduce').default;
const semver = require('semver');
const pMap = require('p-map').default;
const {execa} = require('execa');
const {
  EXACT_PREFIX,
  PATCH_PREFIX,
  MINOR_PREFIX,
  latestVersionForPackage
} = require('../core/versions');
const {executeScript} = require('../core/script');
const {chompCurrentFolder} = require('../core/utils');

const readPackage = packagePath => {
  return readFile(packagePath, 'utf8').then(JSON.parse);
};

const getSemverPrefix = _.pipe(s => s && s.match(/^(\D*)\d+/), _.at(1));

const updatePackageEngines = async (node, npm, pkg, options = {}) => {
  const {exact = false, loose = true, preserveSameMajor = false} = options;
  if (_.isArray(pkg))
    return pMap(pkg, p => updatePackageEngines(node, npm, p, options), {stopOnError: false});

  if (!pkg) return;

  const original = await readPackage(pkg);
  const existingNode = _.get('engines.node', original);
  const minimum = existingNode && semver.minVersion(existingNode);
  if (preserveSameMajor && minimum && semver.major(node) === minimum.major) return;
  const formatVersion = (version, existing) =>
    `${exact ? EXACT_PREFIX : loose ? '>=' : getSemverPrefix(existing) || ''}${version}`;

  const newPackage = _.pipe(
    _.update('engines.node', existingVersion =>
      node ? formatVersion(node, existingVersion) : existingVersion
    ),
    _.update('engines.npm', existingVersion =>
      existingVersion && npm ? formatVersion(npm, existingVersion) : existingVersion
    )
  )(original);

  if (_.isEqual(original, newPackage)) return;

  process.stdout.write(`- Write ${c.bold.dim(chompCurrentFolder(pkg))}\n`);
  return writeFile(pkg, `${JSON.stringify(newPackage, null, 2)}\n`, 'utf8');
};

const preservePrefix = (oldVersion, newVersion) => {
  if (oldVersion.startsWith(MINOR_PREFIX)) return MINOR_PREFIX + newVersion;
  if (oldVersion.startsWith(PATCH_PREFIX)) return PATCH_PREFIX + newVersion;
  return newVersion;
};
const trimPrefix = version => version.replace(PATCH_PREFIX, '').replace(MINOR_PREFIX, '');
const __updateDependencies = (dev = false) => {
  const DEPENDENCY_KEY = dev ? 'devDependencies' : 'dependencies';
  return async (pkg, dependencies) => {
    if (_.isEmpty(dependencies)) return [];
    const pkgObj = await readPackage(pkg);

    const matchingDependencies = _.flatMap(
      dependency =>
        /[*,{}]/.test(dependency)
          ? _.keys(_.get(DEPENDENCY_KEY, pkgObj)).filter(dependencyName =>
              minimatch(dependencyName, dependency)
            )
          : dependency,
      dependencies
    );

    const [newPkgObj, installedPackages] = await pReduce(
      matchingDependencies,
      async (pkgAcc, dependency) => {
        const currentVersion = _.get([DEPENDENCY_KEY, dependency], pkgObj);
        if (!currentVersion) return pkgAcc;
        const newVersion = await latestVersionForPackage(dependency);
        const newVersionWithPrefix = preservePrefix(currentVersion, newVersion);
        if (semver.lte(newVersion, trimPrefix(currentVersion))) return pkgAcc;
        return [
          _.set([DEPENDENCY_KEY, dependency], newVersionWithPrefix, pkgAcc[0]),
          [...pkgAcc[1], [dependency, currentVersion, newVersion]]
        ];
      },
      [pkgObj, []]
    );

    await writeFile(pkg, `${JSON.stringify(newPkgObj, null, 2)}\n`, 'utf8');
    return installedPackages;
  };
};

const updateLock = async (packageManager = 'npm') => {
  if (!_.includes(packageManager, ['npm', 'yarn']))
    throw new Error(`Invalid Package Manager: ${packageManager}`);
  process.stdout.write(`+ Updating dependencies lock with ${c.bold.yellow(packageManager)} 🔐 :\n`);

  await executeScript([
    packageManager === 'npm' ? 'npm install' : 'yarn --ignore-engines --ignore-scripts',
    'echo "Updated Locks"'
  ]);
};

const listLernaPackageFiles = async () => {
  const {stdout} = await execa('npx', ['lerna', 'list', '--json', '--loglevel', 'error']);
  return _.map(
    ({location}) => path.join(chompCurrentFolder(location), 'package.json'),
    JSON.parse(stdout)
  );
};

const updateLearnaPackageEngines = async (nodeVersion, npmVersion, options) => {
  return updatePackageEngines(nodeVersion, npmVersion, await listLernaPackageFiles(), options);

  // note: serverlesses are supposed to be declared to level
};

module.exports = {
  readPackage,
  updatePackageEngines,
  __updateDependencies,
  updateDependencies: __updateDependencies(),
  updateDevDependencies: __updateDependencies(true),
  updateLock,
  listLernaPackageFiles,
  updateLearnaPackageEngines
};
