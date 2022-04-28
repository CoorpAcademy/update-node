const path = require('path');
const fs = require('fs');
const c = require('chalk');
const _ = require('lodash/fp');
const Promise = require('bluebird');

const writeFile = Promise.promisify(fs.writeFile);
const readFile = Promise.promisify(fs.readFile);

const updateDockerfile = (node, dockerfile) => {
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  if (_.isArray(dockerfile)) return Promise.map(dockerfile, d => updateDockerfile(node, d));

  if (!dockerfile || !node) return Promise.resolve();

  const dockerFileP = readFile(dockerfile, 'utf8');

  const newDockerFileP = dockerFileP.then(
    _.replace(/FROM node:\d+\.\d+\.\d+/, `FROM node:${node}`)
  );

  return newDockerFileP
    .then(newDockerFile => writeFile(dockerfile, newDockerFile, 'utf8'))
    .tap(() => process.stdout.write(`- Write ${c.dim.bold(path.basename(dockerfile))}\n`));
};

module.exports = updateDockerfile;
