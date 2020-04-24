const path = require('path');
const fs = require('fs');
const c = require('chalk');
const minimatch = require('minimatch');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const semver = require('semver');
const {
  EXACT_PREFIX,
  PATCH_PREFIX,
  MINOR_PREFIX,
  latestVersionForPackage
} = require('../core/versions');
const executeScript = require('../core/script');

const writeFile = Promise.promisify(fs.writeFile);
const readFile = Promise.promisify(fs.readFile);

const readPackage = packagePath => {
  return readFile(packagePath, 'utf8').then(JSON.parse);
};

const updatePackageEngines = (node, npm, pkg, exact = false) => {
  if (_.isArray(pkg)) return Promise.map(pkg, p => updatePackageEngines(node, npm, p, exact));

  if (!pkg) return Promise.resolve();

  const packageP = readPackage(pkg);

  const SAVE_PREFIX = exact ? EXACT_PREFIX : MINOR_PREFIX;
  const newPackageP = packageP
    .then(node ? _.set('engines.node', `${SAVE_PREFIX}${node}`) : _.identity)
    .then(npm ? _.set('engines.npm', `${SAVE_PREFIX}${npm}`) : _.identity);
  // FIXME: improve, preser >=

  return newPackageP
    .then(obj => {
      const newPackage = JSON.stringify(obj, null, 2);
      return writeFile(pkg, `${newPackage}\n`, 'utf8');
    })
    .tap(() => process.stdout.write(`- Write ${c.bold.dim(path.basename(pkg))}\n`));
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
        dependency.match(/[*,{}]/)
          ? _.keys(_.get(DEPENDENCY_KEY, pkgObj)).filter(dependencyName =>
              minimatch(dependencyName, dependency)
            )
          : dependency,
      dependencies
    );

    const [newPkgObj, installedPackages] = await Promise.reduce(
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

    await writeFile(pkg, `${JSON.stringify(newPkgObj, null, 2)}\n`, 'utf-8');
    return installedPackages;
  };
};

const updateLock = async packager => {
  const packageManager = packager || 'npm';
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
