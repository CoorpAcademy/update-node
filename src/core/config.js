const fs = require('fs');
const path = require('path');
const _ = require('lodash/fp');
const protocall = require('protocall');
const findUp = require('find-up');
const {command, commandSync} = require('execa');
const Joi = require('joi');
const {parseArgvToArray} = require('./utils');
const {getRepoSlug} = require('./git');

const RELEASE_TYPES = ['major', 'minor', 'patch', 'noop'];

const nodeConfig = Joi.object().keys({
  branch: Joi.string(),
  nvmrc: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  dockerfile: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  travis: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  package: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  serverless: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  lerna: Joi.bool()
});
const dependencyClusterConfig = Joi.object().keys({
  name: Joi.string().required(),
  message: Joi.string(),
  branch: Joi.string(),
  dependencies: Joi.array().items(Joi.string()),
  devDependencies: Joi.array().items(Joi.string())
});
const releaseSelectionSchema = Joi.object().pattern(Joi.string().valid(...RELEASE_TYPES), [
  Joi.boolean().invalid(false),
  Joi.string(),
  Joi.array().items(Joi.string())
]);
const configSchema = Joi.object().keys({
  repoSlug: Joi.string().required(),
  baseBranch: Joi.string().required(),
  packageManager: Joi.string(),
  reviewers: [Joi.string(), Joi.array().items(Joi.string())],
  teamReviewers: [Joi.string(), Joi.array().items(Joi.string())],
  label: Joi.string(),
  node: [nodeConfig, Joi.boolean().valid(false)],
  'auto-bump': [
    Joi.bool(),
    Joi.object()
      .keys({
        'bump-command': Joi.string(),
        'release-type-command': Joi.string(),
        publish: Joi.bool(),
        'publish-command': Joi.string(),
        'merge-branch': Joi.string(),
        'sync-branch': Joi.string(),
        priority: Joi.array().items(Joi.string().validate(...RELEASE_TYPES)),
        keywords: releaseSelectionSchema,
        'custom-keywords': releaseSelectionSchema
      })
      .rename('priority', 'release-priority')
      .oxor('keywords', 'custom-keywords')
  ],
  dependencies: Joi.array().items(dependencyClusterConfig).required()
});

const resolver = protocall.getDefaultResolver();
const readConfig = pathe => JSON.parse(fs.readFileSync(pathe));

const resolveGithubToken = async argv => {
  if (!argv.autoToken) return argv.token;
  try {
    const {stdout: ghToken} = await command('gh auth token');
    return ghToken;
  } catch (err) {
    return null;
  }
};

const generateDefaultConfig = () => {
  // TODO: control folder of origin
  const repoSlug = getRepoSlug();
  const packageManager = fs.existsSync('yarn.lock') ? 'yarn' : 'npm';
  let baseBranch = 'master';
  try {
    baseBranch = commandSync('git symbolic-ref refs/remotes/origin/HEAD').split('/').pop();
  } catch (e) {
    /* ignore */
  }

  const defaultConfig = {
    repoSlug,
    baseBranch,
    packageManager,
    reviewers: [],
    teamReviewers: [],
    label: 'Upgrades :outbox_tray:',
    'auto-bump': false,
    node: {
      branch: 'upgrade-node',
      nvmrc: fs.existsSync('.nvmrc'),
      dockerfile: fs.existsSync('Dockerfile'),
      travis: fs.existsSync('.travis.yml'),
      package: true,
      serverless: fs.existsSync('serverless.yml')
      /* optional default config
        loose: true,
        exact: false
      */
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
  if (fs.existsSync('lerna.json')) defaultConfig.node.lerna = true;
  return defaultConfig;
};

const resolveConfig = async (config, configPath, argv) => {
  const base = await resolver.resolve(config);

  const defaultWithPath = (value, defaulte) => {
    const resolvedValue =
      value === true ? [defaulte] : _.isArray(value) ? value : (value && value.split(',')) || [];
    return _.map(val => path.join(path.dirname(configPath), val), resolvedValue);
  };

  base.package = path.join(path.dirname(configPath), base.package || 'package.json');
  if (_.isPlainObject(base.node)) {
    base.node.nvmrc = defaultWithPath(base.node.nvmrc, '.nvmrc');
    base.node.dockerfile = defaultWithPath(base.node.dockerfile, 'Dockerfile');
    base.node.travis = defaultWithPath(base.node.travis, '.travis.yml');
    base.node.package = defaultWithPath(base.node.package, 'package.json');
    base.node.serverless = defaultWithPath(base.node.serverless, 'serverless.yml');
  }
  base.exact = base.node.exact || argv.exact;
  base.loose = base.node.loose !== false && argv.loose; // default logic
  base.argv = argv;
  base.forceFlag = argv.force ? '--force' : '--force-with-lease';
  base.lernaMonorepo = base.node.lerna || argv.lerna;
  base.packageContent = JSON.parse(fs.readFileSync(base.package));
  base.local = argv.local;
  base.token = argv.local ? null : await resolveGithubToken(argv);

  // Combine reviewers config and extra args, removing leading @ for user, and potential specified orga for teams
  base.reviewers = _.pipe(
    parseArgvToArray,
    _.map(_.trimCharsStart('@'))
  )(`${argv.reviewers || ''},${_.join(',', base.reviewers)}`);

  base.teamReviewers = _.pipe(
    parseArgvToArray,
    _.map(_.pipe(_.trimCharsStart('@'), _.split('/'), _.last))
  )(`${argv.teamReviewers || ''},${_.join(',', base.teamReviewers)}`);

  return base;
};

const validateConfig = config => {
  const result = configSchema.validate(config);
  if (result.error) throw result.error;
};

const getConfig = async argv => {
  const configPath = argv.config || findUp.sync('.update-node.json');
  if (!configPath && !argv.defaultConfig) {
    throw new Error('No .update-node.json was found, neither a --config was given');
  }
  const config = configPath ? readConfig(configPath) : generateDefaultConfig();
  // note: default is just a fallback, so if a config there is, this is to be used
  await validateConfig(config);
  const extendedConfig = await resolveConfig(
    config,
    configPath || [process.cwd(), 'fictious-config'].join('/'), // fallback for on the fly config
    argv
  );
  return extendedConfig;
};

module.exports = {
  resolveConfig,
  readConfig,
  getConfig,
  validateConfig,
  resolveGithubToken,
  generateDefaultConfig
};
