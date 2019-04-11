#! /usr/bin/env node

const Promise = require('bluebird');
const c = require('chalk');
const _ = require('lodash/fp');

const bumpDependencies = require('./bump-dependencies');
const bumpVersion = require('./bump-version');
const {setup, validate} = require('./scaffold-config');
const {UPGRADE, BUMP, VALIDATE, SETUP, DIRTY, selectCommand} = require('./commands');
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
    handler: setCommand(UPGRADE)
  })
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
  .option('token', {
    describe: 'Token to authentificate to github',
    string: true,
    alias: 't'
  })
  .option('config', {
    describe: 'Override update-node configuration default path',
    string: true,
    alias: 'c'
  })
  .option('auto', {
    describe: 'Select automatically behavior to adopt based on current commit and branch',
    boolean: true,
    alias: 'A'
  });

const COMMANDS = {
  [UPGRADE]: ['config', bumpDependencies, ['local', 'token']],
  [BUMP]: ['config', bumpVersion, ['local', 'token']],
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

const main = async argv => {
  if (!cmd && argv.auto) {
    cmd = await selectCommand();
    if (cmd) process.stdout.write(c.bold.blue(`🎚  Decided to run the command ${cmd}\n`));
  }
  const [commandType, mainCommand, requiredOptions] = COMMANDS[cmd] || COMMANDS.default;
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
  if (commandType === 'config') {
    const config = await getConfig(argv);
    await mainCommand(config);
  } else if (commandType === 'argv') {
    await mainCommand(argv);
  } else {
    await mainCommand();
  }
};

if (!module.parent) {
  const argv = yargs.parse(process.argv.slice(2));
  main(argv).catch(err => {
    process.stderr.write(`${c.bold.red(err.message)}\n`);
    if (err.details) process.stderr.write(`${err.details}\n`);
    process.stderr.write('\n');
    process.exit(err.exitCode || 2);
  });
}
