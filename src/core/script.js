const Promise = require('bluebird');
const padStream = require('pad-stream');
const shelljs = require('shelljs');
const c = require('chalk');
const split = require('split2');
const through = require('through2');
const pumpify = require('pumpify');

const wrapingStream = size =>
  pumpify(
    split(),
    through(function(data, enc, cb) {
      if (!data) return cb(null, `${data}\n`);
      if (data.length < size) return cb(null, `${data}\n`);
      const lines = data.toString().match(new RegExp(`.{1,${size}}(?=\\s|\\b)?`, 'g'));
      this.push(`${lines[0]}…`);
      lines.slice(1).forEach(line => this.push(`\n    …${line}`));
      cb(null, '\n');
    })
  );

const executeScript = commands =>
  Promise.mapSeries(commands, cmd => {
    if (!cmd) return;
    return new Promise((resolve, reject) => {
      const child = shelljs.exec(cmd, {async: true, silent: true}, err => {
        if (err) return reject(err);
        resolve();
      });
      // eslint-disable-next-line no-unused-vars
      const columns = process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) - 3 : 100;

      const outStream = pumpify(padStream(3), wrapingStream(columns));
      const errStream = pumpify(padStream(3), wrapingStream(columns));
      outStream.pipe(process.stdout);
      errStream.pipe(process.stderr);
      child.stdout.on('data', data => {
        outStream.write(c.dim(data));
      });
      child.stdout.on('close', () => {
        outStream.unpipe();
      });
      child.stderr.on('data', data => {
        errStream.write(c.red(data));
      });
      child.stderr.on('close', () => {
        errStream.unpipe();
      });
    });
  });

module.exports = executeScript;
