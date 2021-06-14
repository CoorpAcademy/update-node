#! /usr/bin/env node

const childProcess = require('child_process');
const c = require('chalk');
const _ = require('lodash/fp');
const {headClean, headMessage, pushFiles} = require('./core/git');
const {makeError} = require('./core/utils');
const executeScript = require('./core/script');

const MAJOR = 'major';
const MINOR = 'minor';
const PATCH = 'patch';
const NOOP = null;

const builtInSelectReleaseType = message => {
  const firstLine = message.split('\n')[0];
  const containsPatchKeyWords = /bug|fix|tweak|plugging/i.test(firstLine);
  const tooShortMessage = firstLine.split(' ').length < 5; // 4 word + PR tag
  const hashtagMinor = /#minor\b/i.test(firstLine);
  const hashtagBug = /#bug\b/i.test(firstLine);
  const hashtagNoop = /#no(op|no[_-]?realease)\b/i.test(message);
  const containsMinorKeyWords = /release|feature/i.test(firstLine);
  const isSquashOrMerge = /Merge pull request #\d+|\(#\D+\)/.test(firstLine);

  if (hashtagNoop) return NOOP;
  if (hashtagBug || containsPatchKeyWords) return PATCH;
  if (hashtagMinor || containsMinorKeyWords) return MINOR;
  if (!isSquashOrMerge) return MINOR;
  if (tooShortMessage) return PATCH;
  return MINOR;
};

const getCustomSelection = cmd => {
  try {
    return childProcess.execSync(cmd, {encoding: 'utf-8'}).trim();
  } catch (err) {
    throw makeError('Failed to get release type', {
      details: `Exit code of selection command '${cmd}' was ${err.status}`,
      exitCode: 5
    });
  }
};

const getReleaseType = async selectionCommand => {
  const releaseType = selectionCommand
    ? getCustomSelection(selectionCommand)
    : await builtInSelectReleaseType(await headMessage());
  if (!_.includes(releaseType, [MAJOR, MINOR, PATCH, NOOP]))
    throw makeError(`Invalid release type ${releaseType}`);
  return releaseType;
};

module.exports = async config => {
  if (!(await headClean())) throw makeError('Not a clean state', {exitCode: 4});
  const autoBumpConfig = config['auto-bump'];
  if (_.isBoolean(autoBumpConfig)) {
    if (!autoBumpConfig) {
      process.stdout.write(c.bold.yellow('Auto-bump is deactivated in config'));
      return;
    }
  } else if (_.isEmpty(autoBumpConfig)) throw makeError('No Config for autobump', {exitCode: 3});
  const releaseSelector = autoBumpConfig['release-type-command'];
  const releaseType = await getReleaseType(releaseSelector);

  if (!releaseType) return process.stdout.write(`Won't make a release\n`);

  process.stdout.write(c.bold.yellow(`About to make a ${c.bold.blue(releaseType)} release\n`));
  const bumpVersionCommand = autoBumpConfig['bump-command'] || 'npm version -m "v%s"';
  await executeScript([`${bumpVersionCommand} ${releaseType}`]);
  if (!config.local) await pushFiles('master', config.token, config.repoSlug, true);
  process.stdout.write(c.bold.green(`Successfully made a ${releaseType} release\n`));
  if (autoBumpConfig.publish || autoBumpConfig['publish-command']) {
    await executeScript([autoBumpConfig['publish-command'] || 'npm publish']);
    process.stdout.write(c.bold.green(`Successfully publish the ${releaseType} release\n`));
  }

  if (autoBumpConfig['sync-branch']) {
    const branch = autoBumpConfig['sync-branch'];
    await executeScript([
      `git config remote.gh.url >/dev/null || git remote add gh https://${config.token}@github.com/${config.repoSlug}.git`,
      `git pull gh ${branch} && git checkout ${branch} && git reset --hard master`,
      `git push gh ${branch}:refs/heads/${branch} --force || (git remote remove gh && exit 12)`,
      'git remote remove gh'
    ]);
    process.stdout.write(c.bold.green(`Successfully sync branch ${branch}\n`));
  }
  if (autoBumpConfig['merge-branch']) {
    const branch = autoBumpConfig['merge-branch'];
    await executeScript([
      `git config remote.gh.url >/dev/null || git remote add gh https://${config.token}@github.com/${config.repoSlug}.git`,
      `git pull gh ${branch} && git checkout ${branch} && git merge master`,
      `git push gh ${branch}:refs/heads/${branch} || (git remote remove gh && exit 12)`,
      'git remote remove gh'
    ]);
    process.stdout.write(c.bold.green(`Successfully merged branch ${branch}\n`));
  }
};
