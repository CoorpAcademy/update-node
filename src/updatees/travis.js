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
  const documentItems = yamlCst[0].contents[0].items;
  const nodejsIndex = _.findIndex(
    _.pipe(
      _.get('strValue'),
      _.equals('node_js')
    ),
    documentItems
  );
  // patch the first item of list in cst node behind node_js
  documentItems[nodejsIndex + 1].node.items[0].node.value = nodeVersion;
  return yamlCst.toString();
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
