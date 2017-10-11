const path = require('path');
const fs = require('fs');
const _ = require('lodash/fp');
const Promise = require('bluebird');

const writeFile = Promise.promisify(fs.writeFile);
const readFile = Promise.promisify(fs.readFile);

const updateDockerfile = (node, dockerfile) => {
  if (_.isArray(dockerfile)) return Promise.map(dockerfile, d => updateDockerfile(node, d));

  if (!dockerfile || !node) return Promise.resolve();

  const dockerFilePath = path.join(process.cwd(), dockerfile);
  const dockerFileP = readFile(dockerFilePath, 'utf8');

  const newDockerFileP = dockerFileP.then(
    _.replace(/FROM node:\d+\.\d+\.\d+/, `FROM node:${node}`)
  );

  return newDockerFileP
    .then(newDockerFile => writeFile(dockerFilePath, newDockerFile, 'utf8'))
    .tap(() => process.stdout.write(`Write ${dockerfile}\n`));
};

module.exports = updateDockerfile;