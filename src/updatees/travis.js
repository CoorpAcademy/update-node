const path = require('path');
const fs = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const YAML = require('yaml');

const readFile = Promise.promisify(fs.readFile);
const writeFile = Promise.promisify(fs.writeFile);

const patchVersionInTravisYaml = nodeVersion => yamlString => {
  const yamlCst = YAML.parseCST(yamlString);
  const documentItems = _.get('[0].contents[0].items', yamlCst);
  if (!documentItems) throw new Error('Travis config file seems not be a valid yaml');
  const nodejsIndex = _.findIndex(
    _.pipe(
      _.get('strValue'),
      _.equals('node_js')
    ),
    documentItems
  );
  if (nodejsIndex === -1) throw new Error('Travis config has missing node_js key');
  // patch the first item of list in cst node behind node_js
  const currentVersionRange = documentItems[nodejsIndex + 1].node.items[0].node.range;
  return (
    yamlString.slice(0, Math.max(0, currentVersionRange.start)) +
    nodeVersion +
    yamlString.slice(currentVersionRange.end, yamlString.length)
  );
};

const updateTravis = (nodeVersion, travis) => {
  if (_.isArray(travis)) return Promise.map(travis, t => updateTravis(nodeVersion, t));

  if (!travis || !nodeVersion) return Promise.resolve();

  return readFile(travis, 'utf8')
    .then(patchVersionInTravisYaml(nodeVersion))
    .then(newTravisYaml => writeFile(travis, newTravisYaml, 'utf8'))
    .tap(() => process.stdout.write(`- Write ${c.bold.dim(path.basename(travis))}\n`));
};

module.exports = updateTravis;
module.exports.patchVersionInTravisYaml = patchVersionInTravisYaml;
