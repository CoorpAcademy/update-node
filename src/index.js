#! /usr/bin/env node

const Promise = require('bluebird');
const c = require('chalk');

const bumpDependencies = require('./bump-dependencies');
const bumpVersion = require('./bump-version');
const {UPGRADE, BUMP, selectCommand} = require('./commands');
const {getConfig} = require('./core/config');

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
  [UPGRADE]: bumpDependencies,
  [BUMP]: bumpVersion,
  default: () => Promise.resolve(process.stdout.write('😴  No command was selected\n'))
};

const main = async argv => {
  if (!argv.local && !argv.token) {
    const error = new Error('Could not run without either options --token or --local');
    error.details = 'Update-Node behavior was changed starting from 2.0';
    error.exitCode = 22;
    throw error;
  }
  if (!cmd && argv.auto) {
    cmd = await selectCommand();
    if (cmd) process.stdout.write(c.bold.blue(`🎚  Decided to run the command ${cmd}\n`));
  }
  const mainCommand = COMMANDS[cmd] || COMMANDS.default;

  // FIXME perform schema validation
  const config = await getConfig(argv);

  await mainCommand(config);
};

if (!module.parent) {
  const argv = yargs.parse(process.argv.slice(2));
  main(argv).catch(err => {
    process.stderr.write(`${c.bold.red(err.message)}\n`);
    if (err.details) process.stderr.write(`${err.details}\n`);
    process.exit(err.exitCode || 2);
  });
}
