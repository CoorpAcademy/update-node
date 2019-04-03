const Promise = require('bluebird');
const shelljs = require('shelljs');
const _ = require('lodash/fp');
const c = require('chalk');

const executeScript = commands =>
  Promise.mapSeries(commands, cmd => {
    if (!cmd) return;
    return new Promise((resolve, reject) => {
      const COLUMNS = process.env.COLUMNS ? _.toString(_.parseInt(process.env.COLUMNS) - 4) : '80';
      const PATH = process.env.PATH;
      const HOME = process.env.HOME;
      const child = shelljs.exec(
        cmd,
        {async: true, silent: true, env: {COLUMNS, PATH, HOME}},
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
      let hasStdout = false;
      let hasStderr = false;
      child.stdout.on('data', data => {
        if (!hasStdout) {
          hasStdout = true;
          process.stdout.write('  ');
        }
        process.stdout.write(c.dim(data.replace(/\n/g, '\n  ')));
      });
      child.stderr.on('data', data => {
        if (!hasStderr) {
          hasStderr = true;
          process.stderr.write('  ');
        }
        process.stderr.write(c.red(data.replace(/\n/g, '\n  ')));
      });
    });
  });

module.exports = executeScript;
