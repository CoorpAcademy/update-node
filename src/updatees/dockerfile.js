const path = require('path');
const {
  promises: {readFile, writeFile}
} = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');

const updateDockerfile = async (node, dockerfile) => {
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  if (_.isArray(dockerfile)) return Promise.map(dockerfile, d => updateDockerfile(node, d));

  if (!dockerfile || !node) return;

  const dockerFile = await readFile(dockerfile, 'utf8');

  const newDockerFile = _.replace(/FROM node:\d+\.\d+\.\d+/, `FROM node:${node}`, dockerFile);

  await writeFile(dockerfile, newDockerFile, 'utf8');
  process.stdout.write(`- Write ${c.dim.bold(path.basename(dockerfile))}\n`);
};

module.exports = updateDockerfile;
