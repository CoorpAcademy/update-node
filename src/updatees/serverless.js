const path = require('path');
const {
  promises: {readFile, writeFile}
} = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const YAML = require('yaml');
const pMap = require('p-map');

// This is patching provider.runtime and any other potention runtime in functions (functions.$any.runtime)

const getYamlPath = (key, item) => _.find(_.matches({key: {source: key}}), item);
const getYamlPathR = (key, item, {raw = false} = {}) =>
  _.includes('.', key)
    ? key.split('.').reduce((acc, k, index, allEntries) => {
        const obj = _.find(_.matches({key: {source: k}}), acc);
        if (raw && _.size(allEntries) - 1 === index) return obj;
        return obj ? (_.isEmpty(obj.value.items) ? obj.value.source : obj.value.items) : null;
      }, item)
    : _.find(_.matches({key: {source: key}}), item);

const listKeysFromItem = item => _.map('key.source', item.value.items);
const listKeys = (key, item) => listKeysFromItem(getYamlPath(key, item));

const patchVersionInServerlessYaml = nodeVersion => yamlString => {
  const parser = new YAML.Parser();
  const nodeMajorVersion = nodeVersion.split('.')[0];
  const newRuntime = `nodejs${nodeMajorVersion}.x`;
  const yamlCst = [...parser.parse(yamlString)];

  const documentItems = _.get('[0].value.items', yamlCst);
  if (!documentItems) throw new Error('Serverless config file seems not be a valid yaml');

  const SERVERLESS_PATCHES = [];

  const serviceRuntimeItem = getYamlPathR('provider.runtime', documentItems, {raw: true});
  if (serviceRuntimeItem) {
    SERVERLESS_PATCHES.push(serviceRuntimeItem);
  }

  for (const lambda of listKeys('functions', documentItems)) {
    const runtime = getYamlPathR(`functions.${lambda}.runtime`, documentItems, {raw: true});
    if (runtime && _.startsWith('node', runtime.value.source)) {
      SERVERLESS_PATCHES.push(runtime);
    }
  }
  return _.reverse(SERVERLESS_PATCHES).reduce(
    (yamlDoc, patch) =>
      yamlDoc.slice(0, Math.max(0, patch.value.offset)) +
      newRuntime +
      yamlDoc.slice(patch.value.end[0].offset, yamlDoc.length),
    yamlString
  );
};

const updateServerless = async (nodeVersion, serverless) => {
  if (_.isArray(serverless)) return pMap(serverless, t => updateServerless(nodeVersion, t));

  if (!serverless || !nodeVersion) return;

  await readFile(serverless, 'utf8')
    .then(patchVersionInServerlessYaml(nodeVersion))
    .then(newTravisYaml => writeFile(serverless, newTravisYaml, 'utf8'));
  process.stdout.write(`- Write ${c.bold.dim(path.basename(serverless))}\n`);
};

module.exports = updateServerless;
module.exports.patchVersionInServerlessYaml = patchVersionInServerlessYaml;
