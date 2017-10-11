const _ = require('lodash/fp');
const executeScript = require('./script');

const install = (options = '') => dependencies => {
  return executeScript(
    `
    yarn add ${_.join(' ', dependencies)} ${options}
    `
  ).tap(() => process.stdout.write(`${dependencies} installed\n`));
};

module.exports = {
  install: install(),
  installDev: install('-D')
};
