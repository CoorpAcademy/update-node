const {execFile} = require('child_process');
const {promisify} = require('util');
const test = require('ava').default;

const exec = promisify(execFile);
const fixtures = [
  {name: 'nvmrc', content: 'v22.12.0\n'},
  {name: 'dockerfile', content: 'FROM node:22.12.0\n'},
  {name: 'travis', content: 'node_js:\n  - 22.12.0\n'},
  {
    name: 'serverless',
    content: 'provider:\n  runtime: nodejs22.x\nfunctions:\n  api:\n    handler: index.handler\n'
  },
  {name: 'package', content: JSON.stringify({engines: {node: '>=22.12.0'}})}
];

for (const {name, content} of fixtures) {
  test(`${name} finishes other file writes before reporting an array update failure`, async t => {
    const modulePath = require.resolve(`../src/updatees/${name}`);
    const {stdout} = await exec(process.execPath, [
      '-e',
      `
      const fs = require('fs').promises;
      const events = [];
      const failure = () => Promise.reject(new Error('bad file'));
      fs.readFile = file => file === 'bad' ? failure() : Promise.resolve(${JSON.stringify(content)});
      fs.writeFile = file => file === 'bad' ? failure() : new Promise(resolve => {
        setTimeout(() => { events.push('write finished'); resolve(); }, 50);
      });
      const exported = require(${JSON.stringify(modulePath)});
      const update = ${name === 'package' ? "exported.updatePackageEngines('24.10.3', '11.6.0', ['bad', 'good'])" : "exported('24.10.3', ['bad', 'good'])"};
      update.then(() => { console.error('Expected a failure'); process.exitCode = 1; })
        .catch(() => { events.push('error reported'); console.log('EVENTS:' + JSON.stringify(events)); });
    `
    ]);
    const events = JSON.parse(stdout.split('EVENTS:')[1].trim());
    t.deepEqual(events, ['write finished', 'error reported']);
  });
}
