const Promise = require('bluebird');
const _ = require('lodash/fp');
const executeScript = require('./script');

const __listDependencies = (isDev, pkg, blacklistedDependencies, requestedDependencies) => {
  const depsKey = isDev ? 'devDependencies' : 'dependencies';
  return _.without(
    blacklistedDependencies,
    _.intersection(requestedDependencies, Object.keys(pkg[depsKey] || {}))
  );
};

const install = isDev => (pkg, blacklistedDependencies, requestedDependencies) => {
  const dependencies = __listDependencies(
    isDev,
    pkg,
    blacklistedDependencies,
    requestedDependencies
  );

  if (_.isEmpty(dependencies)) {
    return Promise.resolve([]);
  }

  const mode = isDev ? '--dev' : '';

  return executeScript([
    `yarn add ${dependencies.join(' ')} --exact --ignore-engines --ignore-scripts ${mode}`
  ]).then(() => {
    process.stdout.write(`${dependencies} installed\n`);
    return dependencies;
  });
};

module.exports = {
  install: install(''),
  installDev: install('--dev'),
  __listDependencies
};
