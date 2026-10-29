const test = require('ava').default;
const {execa} = require('execa');

const github = require.resolve('../src/core/github');
const git = require.resolve('../src/core/git');
const got = require.resolve('got');
const {createNodeUpgradeTarget, nodeUpgradeMarker} = require('../src/core/node-pull-requests');

const publish = async existing => {
  const result = await execa(process.execPath, [
    '-e',
    `
    const events = [];
    require(${JSON.stringify(git)}).pushFiles = async (...args) => events.push(['push', ...args]);
    const pr = {
      number: 10, url: 'https://example.com/pulls/10', issue_url: 'https://example.com/issues/10',
      labels: [{name: 'keep-me'}], user: {login: 'bot'}
    };
    const request = async (url, options) => {
      events.push(['get', url, options]);
      return {statusCode: 200, body: [pr]};
    };
    request.post = async (url, options) => {
      events.push(['post', url, options]);
      return {statusCode: ${existing ? 422 : 201}, body: pr};
    };
    request.patch = async (url, options) => {
      events.push(['patch', url, options]);
      return {statusCode: 200, body: pr};
    };
    require(${JSON.stringify(got)});
    require.cache[${JSON.stringify(got)}].exports = {default: request};
    require(${JSON.stringify(github)}).publishGithub(
      {repoSlug: 'org/repo', baseBranch: 'master', token: 'fake'},
      {branch: 'update-node-api-v24.10', commit: 'candidate-commit', message: 'Upgrade Node',
        pullRequest: {title: 'Upgrade Node to v24.10.3', body: ${JSON.stringify(nodeUpgradeMarker(createNodeUpgradeTarget('24.10.3', 'api')))}}}
    ).then(result => console.log('RESULT:' + JSON.stringify({events, result})))
      .catch(error => {console.error(error); process.exitCode = 1;});
  `
  ]);
  return JSON.parse(result.stdout.split('RESULT:')[1]);
};

for (const existing of [false, true]) {
  test(`${existing ? 'reused' : 'new'} PR receives candidate metadata without requiring a label`, async t => {
    const {events, result} = await publish(existing);
    t.is(events[0][0], 'push');
    t.is(events[0][1], 'update-node-api-v24.10');
    t.is(result.commit, 'candidate-commit');
    t.is(result.pullRequest.number, 10);
    const patch = events.find(event => event[0] === 'patch');
    t.is(patch[2].json.title, 'Upgrade Node to v24.10.3');
    t.regex(patch[2].json.body, /<!-- update-node:/);
    t.deepEqual(patch[2].json.labels, ['keep-me']);
    t.is(
      events.some(event => event[0] === 'get'),
      existing
    );
  });
}
