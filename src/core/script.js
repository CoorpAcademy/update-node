const {Transform, Writable} = require('stream');
const {execa} = require('execa');
const padStream = require('pad-stream').default;
const pMapSeries = require('p-map-series').default;

const c = require('chalk').default;
const split = require('split2');
const through = require('through2').default;
const pumpify = require('pumpify');

const redactCredentials = value =>
  value.toString().replaceAll(/(https?:\/\/)[^/\s@]+@/gi, '$1<REDACTED>@');

const wrappingStream = size =>
  pumpify(
    split(),
    through(function (data, enc, cb) {
      const redactedData = redactCredentials(data);
      if (!redactedData) return cb(null, `${redactedData}\n`);
      if (redactedData.length < size) return cb(null, `${redactedData}\n`);
      const lines = redactedData.toString().match(new RegExp(`.{1,${size}}(?=\\s|\\b)?`, 'g'));
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
  process.stdout.write(`> $ ${c.dim(redactCredentials(commands.join('\n    ')))}\n`) &&
  pMapSeries(commands, async cmd => {
    if (!cmd) return;

    const columns = process.env.COLUMNS ? Number.parseInt(process.env.COLUMNS, 10) - 6 : 100;
    const subprocess = execa(cmd, {shell: true});
    subprocess.stdout.pipe(padAndWrapStream(6, columns, c.dim));
    subprocess.stderr.pipe(padAndWrapStream(6, columns, c.red));
    const {exitCode} = await subprocess;
    if (exitCode !== 0) throw new Error(`exit code ${exitCode}`);
  }).catch(error => {
    error.message = redactCredentials(error.message);
    if (error.shortMessage) error.shortMessage = redactCredentials(error.shortMessage);
    if (error.stderr) error.stderr = redactCredentials(error.stderr);
    if (error.stack) error.stack = redactCredentials(error.stack);
    throw error;
  });

module.exports = {executeScript, wrappingStream, padAndWrapStream};
