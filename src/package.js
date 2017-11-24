const path = require('path');
const fs = require('fs');
const _ = require('lodash/fp');
const Promise = require('bluebird');

const writeFile = Promise.promisify(fs.writeFile);
const readFile = Promise.promisify(fs.readFile);

const updatePackage = (node, npm, pkg) => {
  if (_.isArray(pkg)) return Promise.map(pkg, p => updatePackage(node, npm, p));

  if (!pkg) return Promise.resolve();

  const packagePath = path.join(process.cwd(), pkg);
  const packageP = readFile(packagePath, 'utf8').then(JSON.parse);

  const newPackageP = packageP
    .then(node ? _.set('engines.node', `^${node}`) : _.identity)
    .then(npm ? _.set('engines.npm', `^${npm}`) : _.identity);

  return newPackageP
    .then(obj => {
      const newPackage = JSON.stringify(obj, null, 2);
      return writeFile(packagePath, `${newPackage}\n`, 'utf8');
    })
    .tap(() => process.stdout.write(`Write ${pkg}\n`));
};

module.exports = updatePackage;
