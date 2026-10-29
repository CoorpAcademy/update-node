const {keyBy, pipe, get, filter, trimCharsStart, keys} = require('lodash/fp');
const got = require('got').default;
const {compare, satisfies, valid, prerelease, major, Range} = require('semver');
const pReduce = require('p-reduce').default;

const NODE_VERSIONS = 'https://nodejs.org/dist/index.json';
const NODE_SCHEDULE = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';

const getNodeSchedule = () => got(NODE_SCHEDULE).json();

const isLowerBoundRange = range => /^\s*>=\s*\d/.test(range) && new Range(range).set.length === 1;

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

const findSupportedVersions = async (
  range,
  {
    getVersions = getNodeVersions,
    getSchedule = getNodeSchedule,
    isAvailable = isAvailableOnDocker,
    now = new Date(),
    onSkip = nodeMajor =>
      process.stdout.write(`- No available Docker release for Node ${nodeMajor}; skipping.\n`)
  } = {}
) => {
  const [versions, schedule] = await Promise.all([getVersions(), getSchedule()]);
  const supported = versions
    .filter(release => {
      if (!valid(release.version) || prerelease(release.version)) return false;
      const nodeMajor = major(release.version);
      const dates = schedule[`v${nodeMajor}`];
      return (
        nodeMajor % 2 === 0 &&
        dates &&
        new Date(dates.start) <= now &&
        now < new Date(dates.end) &&
        (!release.date || new Date(release.date) <= now) &&
        satisfies(release.version, range)
      );
    })
    .sort((left, right) => compare(right.version, left.version));
  const majors = [...new Set(supported.map(release => major(release.version)))].sort(
    (left, right) => left - right
  );
  return pReduce(
    majors,
    async (selected, nodeMajor) => {
      const candidates = supported.filter(release => major(release.version) === nodeMajor);
      const version = await findFulfilled(release => isAvailable(release.replace(/^v/, '')))(
        candidates.map(release => release.version)
      );
      if (!version) {
        onSkip(nodeMajor);
        return selected;
      }
      return [...selected, candidates.find(release => release.version === version)];
    },
    []
  );
};

module.exports = {findLatest, getNodeVersions, findSupportedVersions, isLowerBoundRange};
