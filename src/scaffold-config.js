const c = require('chalk');
const findUp = require('find-up');
const {readConfig, validateConfig} = require('./core/config');

const makeError = (message, options = {}) => {
  const error = new Error(message.message || message);
  error.exitCode = message.exitCode || options.exitCode;
  error.details = message.details || options.details;
  return error;
};

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
module.exports = {validate};
