const childProcess = require('child_process');
const _ = require('lodash/fp');
const semver = require('semver');
const Promise = require('bluebird');

const EXACT_PREFIX = '';

const MINOR_PREFIX = '^';
const PATCH_PREFIX = '~';

const versionsForPackage = async (pkg, includePrerelease = false) => {
  const pkgVersions = await new Promise((resolve, reject) => {
    childProcess.execFile('npm', ['view', pkg, 'versions', '--json'], (err, stdout, stderr) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout));
      } catch (parsingError) {
        return reject(parsingError);
      }
    });
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
