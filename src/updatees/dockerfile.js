const path = require('path');
const {
  promises: {readFile, writeFile}
} = require('fs');
const c = require('chalk').default;
const _ = require('lodash/fp');
const pMap = require('p-map').default;

const updateDockerfile = async (node, dockerfile) => {
  if (_.isArray(dockerfile))
    return pMap(dockerfile, d => updateDockerfile(node, d), {stopOnError: false});

  if (!dockerfile || !node) return;

  const dockerFile = await readFile(dockerfile, 'utf8');

  const newDockerFile = _.replace(/FROM node:\d+\.\d+\.\d+/, `FROM node:${node}`, dockerFile);

  await writeFile(dockerfile, newDockerFile, 'utf8');
  process.stdout.write(`- Write ${c.dim.bold(path.basename(dockerfile))}\n`);
};

module.exports = updateDockerfile;
