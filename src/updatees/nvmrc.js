const path = require('path');
const {
  promises: {writeFile}
} = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const Promise = require('bluebird');

const updateNvmrc = async (node, nvmrc) => {
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  if (_.isArray(nvmrc)) return Promise.map(nvmrc, u => updateNvmrc(node, u));

  if (!nvmrc || !node) return;

  await writeFile(nvmrc, `v${node}\n`, 'utf8');
  process.stdout.write(`- Write ${c.bold.dim(path.basename(nvmrc))}\n`);
};

module.exports = updateNvmrc;
