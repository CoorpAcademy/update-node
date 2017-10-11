const path = require('path');
const fs = require('fs');
const _ = require('lodash/fp');
const Promise = require('bluebird');

const writeFile = Promise.promisify(fs.writeFile);

const updateNvmrc = (node, nvmrc) => {
  if (_.isArray(nvmrc)) return Promise.map(nvmrc, u => updateNvmrc(node, u));

  if (!nvmrc || !node) return Promise.resolve();

  const nvmrcPath = path.join(process.cwd(), nvmrc);
  return writeFile(nvmrcPath, `v${node}\n`, 'utf8').tap(() =>
    process.stdout.write(`Write ${nvmrc}\n`)
  );
};

module.exports = updateNvmrc;
