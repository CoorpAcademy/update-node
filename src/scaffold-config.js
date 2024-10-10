const fs = require('fs');
const c = require('chalk');
const findUp = require('find-up');
const {readConfig, validateConfig, generateDefaultConfig} = require('./core/config');
const {makeError} = require('./core/utils');

const validate = argv => {
  const configPath = argv.config || argv._[1] || findUp.sync('.update-node.json');
  if (!configPath) throw makeError('Missing config to validate', {exitCode: 2});
  const config = readConfig(configPath);
  try {
    validateConfig(config);
    process.stdout.write(c.bold.green('Given configuration is valid\n'));
  } catch (err) {
    throw makeError('Config has no valid schema', {exitCode: 1, details: err.message});
  }
};

const setup = argv => {
  const existingConfig = findUp.sync('.update-node.json');
  if (existingConfig)
    throw makeError('.update-node.json already exist', {
      detail: `at following path ${existingConfig}`,
      exitCode: 3
    });

  const defaultConfig = generateDefaultConfig();

  fs.writeFileSync('.update-node.json', JSON.stringify(defaultConfig, null, 2), 'utf8');
};

module.exports = {validate, setup};
