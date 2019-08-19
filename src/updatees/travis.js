const path = require('path');
const fs = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const YAML = require('yaml');

const readFile = Promise.promisify(fs.readFile);
const writeFile = Promise.promisify(fs.writeFile);

const updateTravis = (node, travis) => {
  if (_.isArray(travis)) return Promise.map(travis, t => updateTravis(node, t));

  if (!travis || !node) return Promise.resolve();

  return readFile(travis, 'utf8')
    .then(content => YAML.parseDocument(content, {merge: true}))
    .tap(yaml => yaml.setIn(['node_js', 0], node))
    .then(yaml => yaml.toString())
    .then(newTravisYaml => writeFile(travis, newTravisYaml, 'utf8'))
    .tap(() => process.stdout.write(`- Write ${c.bold.dim(path.basename(travis))}\n`));
};

module.exports = updateTravis;
