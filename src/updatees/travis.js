const path = require('path');
const fs = require('fs');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const yaml = require('js-yaml');

const readFile = Promise.promisify(fs.readFile);
const writeFile = Promise.promisify(fs.writeFile);

const updateTravis = (node, travis) => {
  if (_.isArray(travis)) return Promise.map(travis, t => updateTravis(node, t));

  if (!travis || !node) return Promise.resolve();

  const travisYamlP = readFile(travis, 'utf8').then(yaml.safeLoad);

  const newTravisYamlP = travisYamlP.then(_.set('node_js.0', node));

  return newTravisYamlP
    .then(yaml.safeDump)
    .then(newTravisYaml => writeFile(travis, newTravisYaml, 'utf8'))
    .tap(() => process.stdout.write(`Write ${path.basename(travis)}\n`));
};

module.exports = updateTravis;
