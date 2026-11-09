const c = require('chalk').default;
const _ = require('lodash/fp');

const bumpDependencies = require('./bump-dependencies');
const {main: bumpVersion} = require('./bump-version');
const {cleanupAllNodePullRequests} = require('./core/node-pull-requests');
const {setup, validate} = require('./scaffold-config');
const {UPGRADE, BUMP, CLEANUP, VALIDATE, SETUP, DIRTY, selectCommand} = require('./commands');
const {cleanAndSyncRepo} = require('./core/git');
const {getConfig, getCleanupConfig} = require('./core/config');
const {makeError} = require('./core/utils');

let cmd;
const setCommand = _cmd => () => {
  cmd = _cmd;
};

// eslint-disable-next-line import/order
const yargs = require('yargs')()
  .scriptName('update-node')
  .command({
    command: UPGRADE,
    aliases: ['upgrade', 'bd'],
    describe: 'Upgrade Node.js and configured dependency clusters, then open pull requests',
    builder: command =>
      command
        .options({
          target: {type: 'string', alias: 'T', describe: 'Node.js version or range to target'},
          ignoreDependencies: {
            desc: 'Upgrade only Node.js; skip dependency clusters',
            alias: 'only-node',
            boolean: true
          },
          lerna: {
            desc: 'Update package engines in Lerna workspaces during a Node.js upgrade',
            boolean: true
          },
          message: {
            describe: 'Append a message to upgrade commits and pull requests',
            string: true,
            alias: 'm'
          },
          reviewers: {
            describe: 'Additional GitHub reviewers, separated by commas',
            string: true,
            alias: 'r'
          },
          teamReviewers: {
            describe: 'Additional GitHub team reviewers, separated by commas',
            string: true,
            alias: 'R'
          },
          exact: {
            describe: 'Use exact Node.js and npm engine versions',
            boolean: true,
            default: false
          },
          loose: {
            describe: 'Use >= for engine ranges; --no-loose preserves existing prefixes',
            boolean: true,
            default: true
          }
        })
        .example('$0 bump-dependencies --auto-token', 'Upgrade Node.js and configured dependencies')
        .example(
          '$0 bump-dependencies --only-node --target 24 --auto-token',
          'Upgrade only Node.js to the latest 24.x release'
        )
        .example(
          '$0 bump-dependencies --only-node --local',
          'Prepare Node.js upgrade commits locally'
        )
        .example(
          '$0 bump-dependencies --folder packages/api --scope api --auto-token',
          'Upgrade from a folder and label its PRs with a scope'
        ),
    handler: setCommand(UPGRADE)
  })
  .alias('h', 'help')
  .command({
    command: BUMP,
    aliases: ['version', 'ab'],
    describe: 'Bump the package version and publish if configured',
    builder: command =>
      command.example('$0 auto-bump --auto-token', 'Create a release using the configured rules'),
    handler: setCommand(BUMP)
  })
  .command({
    command: CLEANUP,
    describe: 'Comment on and close superseded generated Node.js upgrade pull requests',
    builder: command =>
      command
        .option('repo', {
          type: 'string',
          requiresArg: true,
          describe: 'GitHub repository (owner/name); no local checkout or configuration needed'
        })
        .example(
          '$0 cleanup-prs --auto-token',
          'Clean up Node.js upgrade PRs for the configured repository'
        )
        .example(
          '$0 cleanup-prs --repo owner/name --auto-token',
          'Clean up another repository without a local checkout'
        ),
    handler: setCommand(CLEANUP)
  })
  .command({
    command: VALIDATE,
    aliases: ['check'],
    describe: 'Check the update-node configuration against its schema',
    builder: command =>
      command
        .example('$0 validate', 'Validate the discovered .update-node.json')
        .example(
          '$0 validate --config .update-node.api.json',
          'Validate a specific configuration file'
        ),
    handler: setCommand(VALIDATE)
  })
  .command({
    command: SETUP,
    aliases: ['scaffold'],
    describe: 'Create .update-node.json using detected repository settings',
    builder: command =>
      command.example('$0 setup', 'Create an initial configuration for this repository'),
    handler: setCommand(SETUP)
  })
  .option('local', {
    describe: 'Keep upgrade commits local and skip GitHub PR cleanup',
    boolean: true,
    alias: 'l'
  })
  .option('verbose', {
    describe: 'Include stack traces when a command fails',
    boolean: true,
    alias: 'v'
  })
  .option('token', {
    describe: 'GitHub token used for authentication',
    string: true,
    alias: 't'
  })
  .option('autoToken', {
    describe: 'Use the GitHub token from gh auth token',
    boolean: true,
    alias: ['a', 'at', 'auto-token']
  })
  .option('auto', {
    describe: 'Choose an upgrade or release from the current branch and commit',
    boolean: true,
    alias: 'A'
  })
  .option('folder', {
    describe: 'Change to this folder before running the command',
    string: true,
    alias: 'F'
  })
  .option('scope', {
    describe: 'Scope for upgrade titles and branch names; does not change folders',
    string: true,
    alias: 's'
  })
  .option('config', {
    describe: 'Read configuration from this file instead of .update-node.json',
    string: true,
    alias: 'C'
  })
  .option('default-config', {
    describe: 'Infer configuration when no configuration file is found',
    boolean: true,
    alias: ['d', 'default']
  })
  .option('clean', {
    describe: 'Stash changes, check out master and pull its upstream',
    boolean: true,
    alias: 'c'
  })
  .option('sync-lock', {
    describe: 'Refresh lockfiles after a Node.js upgrade; disable with --no-sync-lock',
    boolean: true,
    default: true
  })
  .option('pre-commit-bump-command', {
    describe: 'Commands to run before committing a Node.js upgrade; include their changes',
    string: true,
    alias: 'b',
    array: true
  })
  .option('pre-clean-command', {
    describe: 'Commands to run before stashing changes and checking out master',
    string: true,
    alias: 'p',
    array: true
  })
  .option('post-clean-command', {
    describe: 'Commands to run after the clean checkout and pull',
    string: true,
    alias: 'P',
    array: true
  })
  .option('force', {
    describe: 'Push with --force instead of --force-with-lease',
    boolean: true,
    alias: 'f'
  })
  .example('$0 setup', 'Create a configuration for the current repository')
  .example('$0 bump-dependencies --auto-token', 'Upgrade Node.js and configured dependencies')
  .example('$0 auto-bump --auto-token', 'Create a release using the configured rules')
  .example(
    '$0 cleanup-prs --repo owner/name --auto-token',
    'Clean up superseded Node.js upgrade PRs in any repository'
  );

const AUTH_FLAGS = ['local', 'token', 'auto-token'];

const COMMANDS = {
  [UPGRADE]: [
    'config',
    bumpDependencies,
    AUTH_FLAGS,
    argv => {
      if (argv.target) return {nodeVersionOverride: argv.target, onlyNodeVersion: true};
      if (argv.ignoreDependencies) return {ignoreDependencies: true};
      return {};
    }
  ],
  [BUMP]: ['config', bumpVersion, AUTH_FLAGS],
  [CLEANUP]: [
    'argv',
    async argv => cleanupAllNodePullRequests(await getCleanupConfig(argv)),
    AUTH_FLAGS
  ],
  [VALIDATE]: ['argv', validate, []],
  [SETUP]: ['argv', setup, []],
  [DIRTY]: [
    'argv',
    argv =>
      Promise.reject(
        makeError('State is currently dirty, auto cant run', {
          exitCode: 6
        })
      )
  ],
  default: [
    'argv',
    argv =>
      Promise.reject(
        makeError('😴  No command was selected', {
          exitCode: 4,
          details: _.isEmpty(argv._) ? 'No command given' : `Command ${argv._[0]} does not exist`
        })
      )
  ]
};

const runUpdateNode = async argv => {
  let config;
  if (!cmd && argv.auto) {
    config = await getConfig(argv);
    cmd = await selectCommand(config);
    if (cmd) process.stdout.write(c.bold.blue(`🎚  Decided to run the command ${cmd}\n`));
  }
  const [commandType, mainCommand, requiredOptions, inferedOptions = _.constant(undefined)] =
    COMMANDS[cmd] || COMMANDS.default;
  if (!_.isEmpty(requiredOptions) && !_.some(opt => _.has(opt, argv), requiredOptions)) {
    const error = new Error(
      `Could not run command without one of following options: ${requiredOptions
        .map(opt => `--${opt}`)
        .join(', ')}`
    );
    error.details = 'Update-Node behavior was changed starting from 2.0';
    error.exitCode = 22;
    throw error;
  }
  // FIXME perform schema validation
  const mainArg =
    commandType === 'config'
      ? config || (await getConfig(argv)) // do not recompute config if already done
      : commandType === 'argv'
        ? argv
        : undefined;

  if (argv.clean && _.get('baseBranch', mainArg)) {
    await cleanAndSyncRepo(_.pick(['clean', 'preCleanCommand', 'postCleanCommand'], argv));
  }

  await mainCommand(mainArg, inferedOptions(argv));
};

const main = () => {
  const argv = yargs.parse(process.argv.slice(2));
  if (argv.folder) {
    process.chdir(argv.folder);
    process.stdout.write(`📂 Running Update-Node in ${c.bold.yellow(argv.folder)} folder\n`);
  }
  runUpdateNode(argv).catch(err => {
    process.stderr.write(`${c.bold.red(err.message)}\n`);
    if (err.details) process.stderr.write(`${err.details}\n`);
    process.stderr.write('\n');
    if (argv.verbose) {
      process.stderr.write(`${err.stack}\n\n`);
    }
    process.exit(err.exitCode || 2);
  });
};

module.exports = {main, runUpdateNode};

if (!module.parent) {
  main();
}
