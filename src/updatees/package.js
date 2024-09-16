const path = require('path');
const {
  promises: {readFile, writeFile}
} = require('fs');
const c = require('chalk');
const {minimatch} = require('minimatch');
const _ = require('lodash/fp');
const pReduce = require('p-reduce');
const semver = require('semver');
const pMap = require('p-map');
const {
  EXACT_PREFIX,
  PATCH_PREFIX,
  MINOR_PREFIX,
  latestVersionForPackage
} = require('../core/versions');
const {executeScript} = require('../core/script');

const readPackage = packagePath => {
  return readFile(packagePath, 'utf8').then(JSON.parse);
};

const getSemverPrefix = _.pipe(s => s.match(/^(\D*)\d+/), _.at(1));

const updatePackageEngines = async (node, npm, pkg, exact = false) => {
  // TODO: maybe support forcing the choice of prefix (example, to restore loose range like >=)
  if (_.isArray(pkg)) return pMap(pkg, p => updatePackageEngines(node, npm, p, exact));

  if (!pkg) return;

  const newPackage = _.pipe(
    _.update('engines.node', existingVersion =>
      node ? `${exact ? EXACT_PREFIX : getSemverPrefix(existingVersion)}${node}` : existingVersion
    ),
    _.update('engines.npm', existingVersion =>
      npm ? `${exact ? EXACT_PREFIX : getSemverPrefix(existingVersion)}${npm}` : existingVersion
    )
  )(await readPackage(pkg));

  process.stdout.write(`- Write ${c.bold.dim(path.basename(pkg))}\n`);
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
    packageManager === 'npm' ? 'npm install' : 'yarn --ignore-engines --ignore-scripts ',
    'echo "Updated Locks"'
  ]);
};

module.exports = {
  readPackage,
  updatePackageEngines,
  __updateDependencies,
  updateDependencies: __updateDependencies(),
  updateDevDependencies: __updateDependencies(true),
  updateLock
};
