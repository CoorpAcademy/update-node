const childProcess = require('child_process');
const Promise = require('bluebird');
const padStream = require('pad-stream');

const c = require('chalk');
const split = require('split2');
const through = require('through2');
const pumpify = require('pumpify');

const wrappingStream = size =>
  pumpify(
    split(),
    through(function (data, enc, cb) {
      if (!data) return cb(null, `${data}\n`);
      if (data.length < size) return cb(null, `${data}\n`);
      const lines = data.toString().match(new RegExp(`.{1,${size}}(?=\\s|\\b)?`, 'g'));
      this.push(`${lines[0]}…`);
      lines.slice(1).forEach(line => this.push(`\n    …${line}`));
      cb(null, '\n');
    })
  );

const executeScript = commands =>
  // eslint-disable-next-line no-console
  console.log('>', commands) ||
  Promise.each(commands, cmd => {
    if (!cmd) return;
    return new Promise((resolve, reject) => {
      const child = childProcess.exec(cmd);
      const columns = process.env.COLUMNS ? Number.parseInt(process.env.COLUMNS, 10) - 3 : 100;

      const outStream = pumpify(padStream(3), wrappingStream(columns));
      const errStream = pumpify(padStream(3), wrappingStream(columns));
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
      child.on('close', code => {
        if (code !== 0) return reject(new Error(`exit code ${code}`));
        resolve();
      });
    });
  });

module.exports = executeScript;
