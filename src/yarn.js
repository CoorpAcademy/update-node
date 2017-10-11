const _ = require('lodash/fp');
const Promise = require('bluebird');
const executeScript = require('./script');

const install = (options = '') => dependency => {
  if (_.isArray(dependency)) return Promise.map(dependency, p => install(options)(p));

  return executeScript(
    `
    yarn add ${dependency} ${options}
    `
  ).tap(() => process.stdout.write(`${dependency} installed\n`));
};

module.exports = {
  install: install(),
  installDev: install('-D')
};
