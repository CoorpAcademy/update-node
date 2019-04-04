#! /usr/bin/env node

const Promise = require('bluebird');
const c = require('chalk');
const bumpDependencies = require('./bump-dependencies');
const {UPGRADE, BUMP, selectCommand} = require('./commands')

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
  [BUMP]: () => Promise.resolve(process.stdout.write('🏗  Autobump to be implemented\n')),
  default: () => Promise.resolve(process.stdout.write('😴  No command was selected\n'))
};

const main = async argv => {
  if (!argv.local && !argv.token) {
    process.stdout.write(c.red.bold('Could not run without either options --token or --local\n'));
    process.stdout.write('Update-Node behavior was changed starting from 2.0\n\n');
    process.exit(22);
  }
  if (!cmd && argv.auto) {
    cmd = await selectCommand();
    if (cmd) process.stdout.write(c.bold.blue(`🎚  Decided to run the command ${cmd}\n`));
  }
  const mainCommand = COMMANDS[cmd] || COMMANDS.default;

  await mainCommand(argv);
};

if (!module.parent) {
  const argv = yargs.parse(process.argv.slice(2));
  main(argv).catch(err => {
    process.stderr.write(err);
    process.stderr.write('\n');
    process.exit(2);
  });
}
