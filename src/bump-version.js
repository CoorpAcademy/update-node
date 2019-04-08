#! /usr/bin/env node

const c = require('chalk');
const shelljs = require('shelljs');
const _ = require('lodash/fp');
const Promise = require('bluebird');
const {headClean, headMessage} = require('./core/git');
const executeScript = require('./core/script');

const MAJOR = 'major';
const MINOR = 'minor';
const PATCH = 'patch';

const makeError = (message, options = {}) => {
  const error = new Error(message.message || message);
  error.exitCode = message.exitCode || options.exitCode;
  error.details = message.details || options.details;
  return error;
};

const builtInSelectReleaseType = message => {
  const firstLine = message.split('\n')[0];
  const containsPatchKeyWords = /bug|fix|tweak|plugging/i.test(firstLine);
  const tooShortMessage = firstLine.split(' ').length < 5; // 4 word + PR tag
  const hashtagMinor = /#minor\b/i.test(firstLine);
  const hashtagBug = /#bug\b/i.test(firstLine);
  const containsMinorKeyWords = /release|feature/i.test(firstLine);
  const isSquashOrMerge = /Merge pull request #\d+|\(#\D+\)/.test(firstLine);

  if (hashtagBug || containsPatchKeyWords) return PATCH;
  if (hashtagMinor || containsMinorKeyWords) return MINOR;
  if (tooShortMessage) return PATCH;
  if (!isSquashOrMerge) return PATCH;
  return MINOR;
};

const getReleaseType = async selectionCommand => {
  const releaseType = selectionCommand
    ? await new Promise((resolve, reject) => {
        const res = shelljs.exec(selectionCommand);
        if (res.code === 0) return res.stdout;
        throw makeError('Fail to get release type', {
          details: `Exit code of selection command '${selectionCommand}' was ${res.code}`,
          exitCode: 5
        });
      })
    : await builtInSelectReleaseType(await headMessage());
  if (!_.includes(releaseType, [MAJOR, MINOR, PATCH]))
    throw makeError(`Invalid release type ${releaseType}`);
  return releaseType;
};

module.exports = async config => {
  if (!await headClean()) throw makeError('Not a clean state', {exitCode: 4});
  const autoBumpConfig = config['auto-bump'];
  if (_.isBoolean(autoBumpConfig)) {
    if (!autoBumpConfig) {
      process.stdout.write(c.bold.yellow('Auto-bump is deactivated in config'));
      return;
    }
  } else if (_.isEmpty(autoBumpConfig)) throw makeError('No Config for autobump', {exitCode: 3});
  const releaseSelector = autoBumpConfig['release-type-selector'];
  const releaseType = await getReleaseType(releaseSelector);

  process.stdout.write(`About to make a ${c.bold.blue(releaseType)} release\n`);
  const bumpVersionCommand = autoBumpConfig.bumpCommand || 'npm version -m "v%s"';
  await executeScript([`${bumpVersionCommand} ${releaseType}`, 'git push', 'git push --tags']);
  process.stdout.write(c.bold.green(`Successfuly made a ${releaseType} release\n`));
};