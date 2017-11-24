const Promise = require('bluebird');
const _ = require('lodash/fp');
const executeScript = require('./script');

const install = options => dependencies => {
  if (_.isEmpty(dependencies)) return Promise.resolve();
  return executeScript(
    `
    yarn add ${_.join(' ', dependencies)} --exact --ignore-engines --ignore-scripts ${options}
    `
  ).tap(() => process.stdout.write(`${dependencies} installed\n`));
};

module.exports = {
  install: install(''),
  installDev: install('--dev')
};
