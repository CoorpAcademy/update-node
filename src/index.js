#! /usr/bin/env node

const Promise = require('bluebird');
const c = require('chalk');
const bumpDependencies = require('./bump-dependencies');

const UPGRADE = 'bump-dependencies';
const BUMP = 'auto-bump';
let cmd;
const selectCommand = _cmd => () => {
  cmd = _cmd;
};

// eslint-disable-next-line import/order
const yargs = require('yargs')
  .command({
    command: UPGRADE,
    aliases: ['upgrade', 'bd'],
    describe: 'Upgrades defined dependencies and open Pull request for them',
    handler: selectCommand(UPGRADE)
  })
  .command({
    command: BUMP,
    aliases: ['version', 'ab'],
    describe: 'Auto Bump package version',
    handler: selectCommand(BUMP)
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
  });

const COMMANDS = {
  [UPGRADE]: bumpDependencies,
  [BUMP]: () => Promise.resolve(process.stdout.write('🏗  Autobump to be implemented\n'))
};

if (!module.parent) {
  const argv = yargs.parse(process.argv.slice(2));

  if (!argv.local && !argv.token) {
    process.stdout.write(c.red.bold('Could not run without either options --token or --local\n'));
    process.stdout.write('Update-Node behavior was changed starting from 2.0\n\n');
    process.exit(22);
  }
  const main = COMMANDS[cmd]; // TODO: handle default

  main(argv).catch(err => {
    process.stderr.write(err);
    process.stderr.write('\n');
    process.exit(2);
  });
}
