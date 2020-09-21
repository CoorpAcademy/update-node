const fs = require('fs');
const path = require('path');
const _ = require('lodash/fp');
const protocall = require('protocall');
const findUp = require('find-up');
const Joi = require('joi');

const nodeConfig = Joi.object().keys({
  branch: Joi.string(),
  nvmrc: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  dockerfile: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  travis: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())],
  package: [Joi.bool(), Joi.string(), Joi.array().items(Joi.string())]
});
const dependencyClusterConfig = Joi.object().keys({
  name: Joi.string().required(),
  message: Joi.string(),
  branch: Joi.string(),
  dependencies: Joi.array().items(Joi.string()),
  devDependencies: Joi.array().items(Joi.string())
});
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
    Joi.object().keys({
      'bump-command': Joi.string(),
      'release-type-command': Joi.string(),
      publish: Joi.bool(),
      'publish-command': Joi.string(),
      'merge-branch': Joi.string(),
      'sync-branch': Joi.string()
    })
  ],
  dependencies: Joi.array()
    .items(dependencyClusterConfig)
    .required()
});

const resolver = protocall.getDefaultResolver();
const readConfig = pathe => JSON.parse(fs.readFileSync(pathe, 'utf-8'));

const resolveConfig = async (config, configPath, argv) => {
  const base = await resolver.resolve(config);

  const defaultWithPath = (value, defaulte) => {
    const resolvedValue =
      // eslint-disable-next-line no-nested-ternary
      value === true ? [defaulte] : _.isArray(value) ? value : (value && value.split(',')) || [];
    return _.map(val => path.join(path.dirname(configPath), val), resolvedValue);
  };

  base.package = path.join(path.dirname(configPath), base.package || 'package.json');
  if (_.isPlainObject(base.node)) {
    base.node.nvmrc = defaultWithPath(base.node.nvmrc, '.nvmrc');
    base.node.dockerfile = defaultWithPath(base.node.dockerfile, 'Dockerfile');
    base.node.travis = defaultWithPath(base.node.travis, '.travis.yml');
    base.node.package = defaultWithPath(base.node.package, 'package.json');
  }
  base.packageContent = JSON.parse(fs.readFileSync(base.package));
  base.local = argv.local;
  base.token = argv.token;
  return base;
};

const validateConfig = config => {
  const result = configSchema.validate(config);
  if (result.error) throw result.error;
};

const getConfig = async argv => {
  const configPath = argv.config || findUp.sync('.update-node.json');
  if (!configPath) {
    throw new Error('No .update-node.json was found, neither a --config was given');
  }
  const config = readConfig(configPath);
  await validateConfig(config);
  const extendedConfig = await resolveConfig(config, configPath, argv);
  return extendedConfig;
};

module.exports = {resolveConfig, readConfig, getConfig, validateConfig};
