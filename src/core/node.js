const {keyBy, pipe, get, filter, trimCharsStart, keys} = require('lodash/fp');
const got = require('got');
const {compare, satisfies} = require('semver');
const pReduce = require('p-reduce');

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
  pReduce(
    arr,
    (acc, value) => {
      if (acc) return acc;
      return fun(value)
        .then(() => value)
        .catch(() => null);
    },
    null
  );

const findLatest = async range => {
  const versions = await getNodeVersions();

  const mapVersions = keyBy(pipe(get('version'), trimCharsStart('v')), versions);

  const latestAvailableVersion = await pipe(
    keys,
    v => v.sort(compare).reverse(),
    filter(v => satisfies(v, range)),
    findFulfilled(isAvailableOnDocker)
  )(mapVersions);

  return get(latestAvailableVersion, mapVersions);
};

module.exports = {findLatest, getNodeVersions};
