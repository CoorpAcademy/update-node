const _ = require('lodash/fp');
const Promise = require('bluebird');
const shelljs = require('shelljs');

const exec = Promise.promisify(shelljs.exec);

const executeScript = _.pipe(
  _.trim,
  _.split('\n'),
  _.reduce((acc, cmd) => acc.then(() => exec(cmd)), Promise.resolve())
);

module.exports = executeScript;
