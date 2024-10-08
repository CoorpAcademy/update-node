const _ = require('lodash/fp');
const c = require('chalk');
const {executeScript} = require('../core/script');

const __listDependencies = (isDev, pkg, requestedDependencies) => {
  const depsKey = isDev ? 'devDependencies' : 'dependencies';
  return _.intersection(requestedDependencies, Object.keys(pkg[depsKey] || {}));
};

const install = isDev => (pkg, requestedDependencies) => {
  const dependencies = __listDependencies(isDev, pkg, requestedDependencies);

  if (_.isEmpty(dependencies)) {
    return Promise.resolve([]);
  }

  const mode = isDev ? '--dev' : '';

  return executeScript([
    `yarn add ${dependencies.join(' ')} --exact --ignore-engines --ignore-scripts ${mode}`
  ]).then(() => {
    process.stdout.write(`+ ${dependencies.map(d => c.bold.dim(d)).join(', ')} installed\n`);
    return dependencies;
  });
};

module.exports = {
  install: install(''),
  installDev: install('--dev'),
  __listDependencies
};
