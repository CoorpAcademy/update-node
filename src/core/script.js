const Promise = require('bluebird');
const shelljs = require('shelljs');
const c = require('chalk');

const executeScript = commands =>
  Promise.reduce(
    commands,
    (acc, cmd) => {
      if (!cmd) return;
      return new Promise((resolve, reject) => {
        const child = shelljs.exec(cmd, {async: true, silent: true}, err => {
          if (err) return reject(err);
          resolve();
        });
        child.stdout.on('data', data => process.stdout.write(c.dim(data)));
      });
    },
    null
  );

module.exports = executeScript;
