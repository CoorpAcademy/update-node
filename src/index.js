const c = require('chalk');
const _ = require('lodash/fp');

const bumpDependencies = require('./bump-dependencies');
const {main: bumpVersion} = require('./bump-version');
const {setup, validate} = require('./scaffold-config');
const {UPGRADE, BUMP, VALIDATE, SETUP, DIRTY, selectCommand} = require('./commands');
const {cleanAndSyncRepo} = require('./core/git');
const {getConfig} = require('./core/config');
const {makeError} = require('./core/utils');

let cmd;
const setCommand = _cmd => () => {
  cmd = _cmd;
};

// eslint-disable-next-line import/order
const yargs = require('yargs')
  .command({
    command: UPGRADE,
    aliases: ['upgrade', 'bd'],
    describe: 'Upgrades defined dependencies and open Pull request for them',
    builder: {
      target: {type: 'string', alias: 'T', describe: 'Node version to target'},
      ignoreDependencies: {
        desc: 'Ignore depencies',
        alias: 'only-node',
        boolean: true
      },
      lerna: {
        desc: 'Consider as learna monorepo (only applies for node bump)',
        boolean: true
      },
      message: {
        describe: 'Optional extra message to attach to the commit and pull request',
        string: true,
        alias: 'm'
      },
      reviewers: {
        describe: 'Extra reviewers to add to the pull request',
        string: true,
        alias: 'r'
      },
      teamReviewers: {
        describe: 'Extra team reviewers to add to the pull request',
        string: true,
        alias: 'R'
      },
      exact: {
        describe: 'Keep exact version in engine version',
        boolean: true,
        default: false
      },
      loose: {
        describe: `For loose version for nodes version. This will replace exisiting range constraint (^, ~ or none).
       Use --no-loose to disable or place loose: false in config in the node section)`,
        boolean: true,
        default: true
      }
    },
    handler: setCommand(UPGRADE)
  })
  .alias('h', 'help')
  .command({
    command: BUMP,
    aliases: ['version', 'ab'],
    describe: 'Auto Bump package version',
    handler: setCommand(BUMP)
  })
  .command({
    command: VALIDATE,
    aliases: ['check'],
    describe: 'Validate a update-node configuration',
    handler: setCommand(VALIDATE)
  })
  .command({
    command: SETUP,
    aliases: ['scaffold'],
    describe: 'Scaffold a update-node configuration',
    handler: setCommand(SETUP)
  })
  .option('local', {
    describe: 'Run in local mode with github publication',
    boolean: true,
    alias: 'l'
  })
  .option('verbose', {
    describe: 'More log outputs',
    boolean: true,
    alias: 'v'
  })
  .option('token', {
    describe: 'Token to authentificate to github',
    string: true,
    alias: 't'
  })
  .option('autoToken', {
    describe: 'Get authentificated github token from gh cli',
    boolean: true,
    alias: ['a', 'at', 'auto-token']
  })
  .option('auto', {
    describe: 'Select automatically behavior to adopt based on current commit and branch',
    boolean: true,
    alias: 'A'
  })
  .option('folder', {
    describe: 'Run in a specific folder',
    string: true,
    alias: 'F'
  })
  .option('scope', {
    describe: 'Apply to a scope of the repository (impact on title and branch name)',
    string: true,
    alias: 's'
  })
  .option('config', {
    describe: 'Override update-node configuration default path',
    string: true,
    alias: 'C'
  })
  .option('default-config', {
    describe: 'Override update-node configuration default path',
    boolean: true,
    alias: ['d', 'default']
  })
  .option('clean', {
    describe: 'Run on a clean state',
    boolean: true,
    alias: 'c'
  })
  .option('sync-lock', {
    describe:
      'Run npm install or yarn after patching package.json (default, disable with --no-sync-lock)',
    boolean: true,
    default: true
  })
  .option('pre-commit-bump-command', {
    describe: 'Command to run before to commit (changes will be commited)',
    string: true,
    alias: 'b',
    array: true
  })
  .option('pre-clean-command', {
    describe: 'Run before to clean state',
    string: true,
    alias: 'p',
    array: true
  })
  .option('post-clean-command', {
    describe: 'Run on a clean state',
    string: true,
    alias: 'P',
    array: true
  })
  .option('force', {
    describe: 'Git Push with force changes (--force-with-lease is used by default)',
    boolean: true,
    alias: 'f'
  });

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
