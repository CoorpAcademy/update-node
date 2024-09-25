const semver = require('semver');
const {headMessage, headBranch, headClean} = require('./core/git');

const VALIDATE = 'validate';
const UPGRADE = 'bump-dependencies';
const BUMP = 'auto-bump';
const SETUP = 'setup';
const DIRTY = 'warn-dirty';
const NOOP = 'noop';

const selectCommand = async () => {
  const [branch, message, clean] = await Promise.all([headBranch(), headMessage(), headClean()]);
  if (!clean) return DIRTY;
  if (branch !== 'master') return UPGRADE;
  // §todo: make it configurable
  if (semver.valid(message)) return UPGRADE;
  return BUMP;
};

module.exports = {
  UPGRADE,
  BUMP,
  DIRTY,
  VALIDATE,
  SETUP,
  NOOP,
  selectCommand
};
