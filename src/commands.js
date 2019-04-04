const Promise = require('bluebird');
const semver = require('semver');
const {headMessage, headBranch} = require('./core/git');

const UPGRADE = 'bump-dependencies';
const BUMP = 'auto-bump';

const selectCommand = async () => {
  const [branch, message] = await Promise.all([headBranch(), headMessage()]);
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
