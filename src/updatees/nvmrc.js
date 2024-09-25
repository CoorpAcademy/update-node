const path = require('path');
const {
  promises: {writeFile}
} = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const pMap = require('p-map');

const updateNvmrc = async (node, nvmrc) => {
  if (_.isArray(nvmrc)) return pMap(nvmrc, u => updateNvmrc(node, u));

  if (!nvmrc || !node) return;

  await writeFile(nvmrc, `v${node}\n`, 'utf8');
  process.stdout.write(`- Write ${c.bold.dim(path.basename(nvmrc))}\n`);
};

module.exports = updateNvmrc;
