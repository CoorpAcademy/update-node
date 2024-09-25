const exec = require('execa');
const _ = require('lodash/fp');
const semver = require('semver');

const EXACT_PREFIX = '';

const MINOR_PREFIX = '^';
const PATCH_PREFIX = '~';

const versionsForPackage = async (pkg, includePrerelease = false) => {
  const pkgVersions = await exec('npm', ['view', pkg, 'versions', '--json']).then(({stdout, err}) =>
    JSON.parse(stdout)
  );
  return includePrerelease ? pkgVersions : _.filter(v => !semver.prerelease(v), pkgVersions);
};

const latestVersionForPackage = async (pkg, includePrerelease = false) => {
  return _.last(await versionsForPackage(pkg, includePrerelease));
};

module.exports = {
  EXACT_PREFIX,
  MINOR_PREFIX,
  PATCH_PREFIX,
  versionsForPackage,
  latestVersionForPackage
};
