const {Transform, Writable} = require('stream');
const {command} = require('execa');
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

const padAndWrapStream = (padLength, columns, wrapper) =>
  pumpify(
    padStream(padLength),
    wrappingStream(columns),
    new Transform({
      transform(chunk, encoding, callback) {
        callback(null, wrapper(chunk));
      }
    }),
    new Writable({
      write(chunk, encoding, callback) {
        process.stdout.write(chunk);
        callback();
      }
    })
  );

const executeScript = commands =>
  process.stdout.write(`> $ ${c.dim(commands.join('\n    '))}\n`) &&
  Promise.each(commands, async cmd => {
    if (!cmd) return;

    const columns = process.env.COLUMNS ? Number.parseInt(process.env.COLUMNS, 10) - 6 : 100;
    const subprocess = command(cmd, {shell: true});
    subprocess.stdout.pipe(padAndWrapStream(6, columns, c.dim));
    subprocess.stderr.pipe(padAndWrapStream(6, columns, c.red));
    const {exitCode} = await subprocess;
    if (exitCode !== 0) throw new Error(`exit code ${exitCode}`);
  });

module.exports = {executeScript, wrappingStream, padAndWrapStream};
