const {keyBy, pipe, get, filter, trimCharsStart, keys} = require('lodash/fp');
const got = require('got');
const Promise = require('bluebird');
const {compare, satisfies} = require('semver');

const NODE_VERSIONS = 'https://nodejs.org/dist/index.json';

const getNodeVersions = () =>
  got(NODE_VERSIONS, {responseType: 'json'}).then(response => {
    if (response.statusCode !== 200) throw new Error("nodejs.org isn't available");
    return response.body;
  });

const DOCKER_TAGS = version =>
  `https://hub.docker.com/v2/repositories/library/node/tags/${version}/`;

const isAvailableOnDocker = version =>
  got(DOCKER_TAGS(version), {responseType: 'json'}).then(response => {
    if (response.statusCode !== 200) throw new Error(`Node's image ${version} isn't available`);
    return response.body;
  });

const findFulfilled = fun => arr =>
  Promise.resolve(arr).reduce((acc, value) => {
    if (acc) return acc;
    return fun(value)
      .then(() => value)
      .catch(() => null);
  }, null);

const findLatest = range => {
  const versionsP = getNodeVersions();

  const mapVersionsP = versionsP.then(keyBy(pipe(get('version'), trimCharsStart('v'))));

  const latestAvailableVersionP = mapVersionsP
    .then(keys)
    .then(v => v.sort(compare).reverse())
    .then(filter(v => satisfies(v, range)))
    .then(findFulfilled(isAvailableOnDocker));

  return Promise.all([latestAvailableVersionP, mapVersionsP]).spread(get);
};

module.exports = {findLatest, getNodeVersions};
