const path = require('path');
const fs = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const YAML = require('yaml');

const readFile = Promise.promisify(fs.readFile);
const writeFile = Promise.promisify(fs.writeFile);

const parser = new YAML.Parser();

const patchVersionInTravisYaml = nodeVersion => yamlString => {
  const yamlCst = [...parser.parse(yamlString)];
  const documentItems = _.get('[0].value.items', yamlCst);
  if (!documentItems) throw new Error('Travis config file seems not be a valid yaml');
  const nodejsItem = _.find(_.matches({key: {source: 'node_js'}}), documentItems);
  if (nodejsItem === null) throw new Error('Travis config has missing node_js key');
  const versionItem = nodejsItem.value.items[0].value;
  return (
    yamlString.slice(0, Math.max(0, versionItem.offset)) +
    nodeVersion +
    yamlString.slice(versionItem.end[0].offset, yamlString.length)
  );
};

const updateTravis = (nodeVersion, travis) => {
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  if (_.isArray(travis)) return Promise.map(travis, t => updateTravis(nodeVersion, t));

  if (!travis || !nodeVersion) return Promise.resolve();

  return readFile(travis, 'utf8')
    .then(patchVersionInTravisYaml(nodeVersion))
    .then(newTravisYaml => writeFile(travis, newTravisYaml, 'utf8'))
    .tap(() => process.stdout.write(`- Write ${c.bold.dim(path.basename(travis))}\n`));
};

module.exports = updateTravis;
module.exports.patchVersionInTravisYaml = patchVersionInTravisYaml;
