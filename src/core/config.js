const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash/fp');
const shortstop = require('shortstop');
const handlers = require('shortstop-handlers');
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
  node: nodeConfig,
  'auto-bump': [
    Joi.bool(),
    Joi.object().keys({
      'bump-command': Joi.string(),
      'release-type-command': Joi.string()
    })
  ],
  dependencies: Joi.array()
    .items(dependencyClusterConfig)
    .required()
});

const resolver = shortstop.create();
resolver.use('env', handlers.env());
resolver.use('base64', handlers.base64());
const readConfig = pathe => JSON.parse(fs.readFileSync(pathe, 'utf-8'));

const resolveConfig = async (config, configPath, argv) => {
  const base = await new Promise((resolve, reject) => {
    resolver.resolve(config, (err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });

  const defaultWithPath = (value, defaulte) => {
    const resolvedValue =
      // eslint-disable-next-line no-nested-ternary
      value === true ? [defaulte] : _.isArray(value) ? value : (value && value.split(',')) || [];
    return _.map(val => path.join(path.dirname(configPath), val), resolvedValue);
  };

  base.package = path.join(path.dirname(configPath), base.package || 'package.json');
  base.node.nvmrc = defaultWithPath(base.node.nvmrc, '.nvmrc');
  base.node.dockerfile = defaultWithPath(base.node.dockerfile, 'Dockerfile');
  base.node.travis = defaultWithPath(base.node.travis, '.travis.yml');
  base.node.package = defaultWithPath(base.node.package, 'package.json');
  base.local = argv.local;
  base.token = argv.token;
  return base;
};

const validateConfig = config => {
  const result = Joi.validate(config, configSchema);
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
