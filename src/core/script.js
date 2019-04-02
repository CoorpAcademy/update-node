const Promise = require('bluebird');
const shelljs = require('shelljs');
const c = require('chalk');

const executeScript = commands =>
  Promise.mapSeries(commands, cmd => {
    if (!cmd) return;
    return new Promise((resolve, reject) => {
      const child = shelljs.exec(cmd, {async: true, silent: true}, err => {
        if (err) return reject(err);
        resolve();
      });
      child.stdout.on('data', data => process.stdout.write(c.dim(data)));
      child.stderr.on('data', data => process.stderr.write(c.red(data)));
    });
  });

module.exports = executeScript;
