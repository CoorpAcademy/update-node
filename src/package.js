const path = require('path');
const fs = require('fs');
const _ = require('lodash/fp');
const Promise = require('bluebird');

const writeFile = Promise.promisify(fs.writeFile);
const readFile = Promise.promisify(fs.readFile);

const EXACT_PREFIX = '';

const MINOR_PREFIX = '^';
const readPackage = pkg => {
  const packagePath = path.join(process.cwd(), pkg);
  return readFile(packagePath, 'utf8').then(JSON.parse);
};

const updatePackage = (node, npm, pkg, exact = false) => {
  if (_.isArray(pkg)) return Promise.map(pkg, p => updatePackage(node, npm, p, exact));

  if (!pkg) return Promise.resolve();

  const packagePath = path.join(process.cwd(), pkg);
  const packageP = readPackage(pkg);

  const SAVE_PREFIX = exact ? EXACT_PREFIX : MINOR_PREFIX;
  const newPackageP = packageP
    .then(node ? _.set('engines.node', `${SAVE_PREFIX}${node}`) : _.identity)
    .then(npm ? _.set('engines.npm', `${SAVE_PREFIX}${npm}`) : _.identity);

  return newPackageP
    .then(obj => {
      const newPackage = JSON.stringify(obj, null, 2);
      return writeFile(packagePath, `${newPackage}\n`, 'utf8');
    })
    .tap(() => process.stdout.write(`Write ${pkg}\n`));
};

module.exports = {
  readPackage,
  updatePackage
};
