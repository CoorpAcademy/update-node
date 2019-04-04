#! /usr/bin/env node

const c = require('chalk');
const bumpDependencies = require('./bump-dependencies');

// eslint-disable-next-line import/order
const yargs = require('yargs')
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

if (!module.parent) {
  const argv = yargs.parse(process.argv);

  if (!argv.local && !argv.token) {
    process.stdout.write(c.red.bold('Could not run without either options --token or --local\n'));
    process.stdout.write('Update-Node behavior was changed starting from 2.0\n\n');
    process.exit(22);
  }
  bumpDependencies(argv).catch(err => {
    process.stderr.write(err);
    process.stderr.write('\n');
    process.exit(2);
  });
}
