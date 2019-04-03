const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash/fp');
const shortstop = require('shortstop');
const handlers = require('shortstop-handlers');

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

module.exports = {resolveConfig, readConfig};