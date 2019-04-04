const shelljs = require('shelljs');
const _ = require('lodash/fp');
const semver = require('semver');
const Promise = require('bluebird');

const EXACT_PREFIX = '';

const MINOR_PREFIX = '^';
const PATCH_PREFIX = '~';

const versionsForPackage = async (pkg, includePrerelease = false) => {
  const pkgVersions = await new Promise((resolve, reject) => {
    const versionsRaw = shelljs.exec(`npm view ${pkg} versions --json`, {silent: true});
    try {
      resolve(JSON.parse(versionsRaw.stdout));
    } catch (err) {
      return reject(err);
    }
  });
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
