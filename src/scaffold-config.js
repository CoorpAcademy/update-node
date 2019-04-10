const fs = require('fs');
const c = require('chalk');
const findUp = require('find-up');
const {readConfig, validateConfig} = require('./core/config');
const {getRepoSlug} = require('./core/git');

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

const setup = argv => {
  const existingConfig = findUp.sync('.update-node.json');
  if (existingConfig)
    throw makeError('.update-node.json already exist', {
      detail: `at following path ${existingConfig}`,
      exitCode: 3
    });

  const repoSlug = getRepoSlug();
  const packageManager = fs.existsSync('yarn.lock') ? 'yarn' : 'npm';
  const defaultConfig = {
    repoSlug,
    baseBranch: 'master',
    packageManager,
    reviewers: [],
    teamReviewers: [],
    label: 'Upgrades :outbox_tray:',
    'auto-bump': false,
    node: {
      branch: 'upgrade-node',
      nvmrc: true,
      dockerfile: false,
      travis: false,
      package: false
    },
    dependencies: [
      {
        name: 'core',
        message: 'Update core dependencies',
        branch: 'update-core',
        dependencies: [],
        devDependencies: []
      }
    ]
  };

  fs.writeFileSync('.update-node.json', JSON.stringify(defaultConfig, null, 2), 'utf-8');
};

module.exports = {validate, setup};
