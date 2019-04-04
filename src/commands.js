const Promise = require('bluebird');
const semver = require('semver');
const {headMessage, headBranch, headClean} = require('./core/git');

const UPGRADE = 'bump-dependencies';
const BUMP = 'auto-bump';
const NOOP = undefined;

const selectCommand = async () => {
  const [branch, message, clean] = await Promise.all([headBranch(), headMessage(), headClean()]);
  if (!clean) return NOOP;
  if (branch !== 'master') return UPGRADE;
  // §todo: make it configurable
  if (semver.valid(message)) return UPGRADE;
  return BUMP;
};

module.exports = {
  UPGRADE,
  BUMP,
  selectCommand
};
