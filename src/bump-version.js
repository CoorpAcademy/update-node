#! /usr/bin/env node

const {sync: execSync} = require('execa');
const c = require('chalk');
const _ = require('lodash/fp');
const {minimatch} = require('minimatch');
const {headClean, headMessage, pushFiles} = require('./core/git');
const {makeError} = require('./core/utils');
const {executeScript} = require('./core/script');

const MAJOR = 'major';
const MINOR = 'minor';
const PATCH = 'patch';
const NOOP = 'noop';

const DEFAULT_KEYWORDS = {
  noop: ['#noop', '#no{_,-,}release'],
  major: '#major',
  minor: ['#minor'],
  patch: ['#patch', '#bug', '#fix', '#tweak', '#updates']
};
const DEFAULT_KEYWORD_PRIORITY = [NOOP, MAJOR, PATCH, MINOR];

const builtInSelectReleaseType = (config, message) => {
  const {keywords, releasePriority} = config;

  for (const releaseType of releasePriority) {
    const releaseTypeConfig = keywords[releaseType];
    if (!releaseTypeConfig) continue;
    if (releaseTypeConfig === true) return releaseType;

    const patterns = [releaseTypeConfig].flat();
    if (_.some(pattern => minimatch(_.toLower(message), _.toLower(`*${pattern}*`)), patterns))
      return releaseType;
  }
  return _.last(releasePriority);
};

const mergeCustomKeywordsWithDefault = customKeywords => {
  if (!customKeywords) return DEFAULT_KEYWORDS;
  return _.pipe(
    _.toPairs,
    _.map(([releaseType, defaultKeywords]) => [
      releaseType,
      [...[defaultKeywords].flat(), ...[_.getOr([], releaseType, customKeywords)].flat()]
    ]),
    _.fromPairs
  )(DEFAULT_KEYWORDS);
};

const getBuiltInSelection = async (config, messageOverride) => {
  const message = messageOverride || (await headMessage());

  const releasePriority = _.getOr(DEFAULT_KEYWORD_PRIORITY, 'priority', config);
  const keywords =
    _.get('keywords', config) || mergeCustomKeywordsWithDefault(_.get('custom-keywords', config));

  return builtInSelectReleaseType({keywords, releasePriority}, message);
};

const getCustomSelection = cmd => {
  try {
    return execSync(cmd);
  } catch (err) {
    throw makeError('Failed to get release type', {
      details: `Exit code of selection command '${cmd}' was ${err.status}`,
      exitCode: 5
    });
  }
};

const getReleaseType = async relaseConfig => {
  const releaseSelector = relaseConfig['release-type-command'];
  const releaseType = releaseSelector
    ? getCustomSelection(releaseSelector)
    : await getBuiltInSelection(relaseConfig);
  if (!_.includes(releaseType, [MAJOR, MINOR, PATCH, NOOP]))
    throw makeError(`Invalid release type ${releaseType}`);
  return releaseType;
};

const main = async config => {
  if (!(await headClean())) throw makeError('Not a clean state', {exitCode: 4});
  const autoBumpConfig = config['auto-bump'];
  if (_.isBoolean(autoBumpConfig)) {
    if (!autoBumpConfig) {
      process.stdout.write(c.bold.yellow('Auto-bump is deactivated in config'));
      return;
    }
  } else if (_.isEmpty(autoBumpConfig)) throw makeError('No Config for autobump', {exitCode: 3});
  const releaseType = await getReleaseType(autoBumpConfig);

  if (releaseType === NOOP) return process.stdout.write(`Won't make a release\n`);

  process.stdout.write(c.bold.yellow(`About to make a ${c.bold.blue(releaseType)} release\n`));
  const bumpVersionCommand = autoBumpConfig['bump-command'] || 'npm version -m "v%s"';
  await executeScript([`${bumpVersionCommand} ${releaseType}`]);
  if (!config.local)
    await pushFiles('master', config.token, config.repoSlug, {
      tags: true,
      forceFlag: '--force'
    });
  process.stdout.write(c.bold.green(`Successfully made a ${releaseType} release\n`));
  if (autoBumpConfig.publish || autoBumpConfig['publish-command']) {
    await executeScript([autoBumpConfig['publish-command'] || 'npm publish']);
    process.stdout.write(c.bold.green(`Successfully publish the ${releaseType} release\n`));
  }

  if (autoBumpConfig['sync-branch']) {
    const branch = autoBumpConfig['sync-branch'];
    await executeScript([
      `git config remote.gh.url >/dev/null || git remote add gh https://${config.token}@github.com/${config.repoSlug}.git`,
      `git fetch gh  && git checkout -B ${branch} master`,
      `git push gh ${branch}:refs/heads/${branch} ${config.forceFlag} || (git remote remove gh && exit 12)`,
      'git remote remove gh'
    ]);
    process.stdout.write(c.bold.green(`Successfully sync branch ${branch}\n`));
  }
  if (autoBumpConfig['merge-branch']) {
    const branch = autoBumpConfig['merge-branch'];
    await executeScript([
      `git config remote.gh.url >/dev/null || git remote add gh https://${config.token}@github.com/${config.repoSlug}.git`,
      `git fetch gh && git checkout -B ${branch} gh/${branch} && git merge master`,
      `git push gh ${branch}:refs/heads/${branch} || (git remote remove gh && exit 12)`,
      'git remote remove gh'
    ]);

    process.stdout.write(c.bold.green(`Successfully merged branch ${branch}\n`));
  }
};

module.exports = {
  main,
  builtInSelectReleaseType,
  getReleaseType,
  getBuiltInSelection,
  getCustomSelection,
  mergeCustomKeywordsWithDefault
};
