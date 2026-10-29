const test = require('ava').default;
const {execa} = require('execa');

const github = require.resolve('../src/core/github');
const git = require.resolve('../src/core/git');
const got = require.resolve('got');
const {createNodeUpgradeTarget, nodeUpgradeMarker} = require('../src/core/node-pull-requests');

const publish = async (existing, options = {}) => {
  const {sync = false, failPush = false} = options;
  const result = await execa(process.execPath, [
    '-e',
    `
    const events = [];
    const scenario = ${JSON.stringify(options)};
    const git = require(${JSON.stringify(git)});
    git.pushFiles = async (...args) => {
      events.push(['push', ...args]);
      if (${failPush}) throw new Error('push failed');
    };
    git.commitFiles = async (...args) => { events.push(['commit', ...args]); return !scenario.noChanges; };
    git.headCommit = branch => { events.push(['head', branch]); return 'candidate-commit'; };
    const pr = {
      number: 10, url: 'https://example.com/pulls/10', issue_url: 'https://example.com/issues/10',
      labels: [{name: 'keep-me'}], user: {login: 'bot'}
    };
    const request = async (url, options) => {
      events.push(['get', url, options]);
      return {statusCode: scenario.searchStatus || 200, body: scenario.searchStatus ? {message: 'search failed'} : scenario.noMatch ? [] : [pr]};
    };
    request.post = async (url, options) => {
      events.push(['post', url, options]);
      if (url.endsWith('/requested_reviewers'))
        return {statusCode: scenario.reviewStatus || 201, body: {message: 'review request failed'}};
      return {statusCode: scenario.createStatus || ${existing ? 422 : 201}, body: scenario.createStatus ? {message: 'creation failed'} : pr};
    };
    request.patch = async (url, options) => {
      events.push(['patch', url, options]);
      return {statusCode: scenario.patchStatus || 200, body: scenario.patchStatus ? {message: 'metadata failed'} : pr};
    };
    require(${JSON.stringify(got)});
    require.cache[${JSON.stringify(got)}].exports = {default: request};
    const github = require(${JSON.stringify(github)});
    const content = {title: 'Upgrade Node to v24.10.3', body: ${JSON.stringify(nodeUpgradeMarker(createNodeUpgradeTarget('24.10.3', 'api')))}};
    if (scenario.reviewStatus) Object.assign(content, {reviewers: ['reviewer'], team_reviewers: ['team'], label: 'upgrade'});
    const publication = ${sync} ? github.syncGithub(
      'org/repo', 'master', 'update-node-api-v24.10', 'Upgrade Node', content, 'fake', '--force-with-lease', 'master'
    ) : github.publishGithub(
      {repoSlug: 'org/repo', baseBranch: 'master', token: 'fake'},
      {branch: 'update-node-api-v24.10', commit: 'candidate-commit', message: 'Upgrade Node',
        pullRequest: content}
    );
    publication.then(result => console.log('RESULT:' + JSON.stringify({events, result: {...result, error: result.error?.message}})))
      .catch(error => console.log('RESULT:' + JSON.stringify({events, error: error.message})));
  `
  ]);
  return {...JSON.parse(result.stdout.split('RESULT:')[1]), stdout: result.stdout};
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

test('legacy publication reports the candidate branch commit after restoring the checkout', async t => {
  const {events, result} = await publish(false, {sync: true});
  t.deepEqual(events.slice(0, 2), [
    ['commit', 'update-node-api-v24.10', 'Upgrade Node', 'master'],
    ['head', 'update-node-api-v24.10']
  ]);
  t.is(result.commit, 'candidate-commit');
  t.is(result.pullRequest.number, 10);
  t.is(events.find(event => event[0] === 'push')[4].forceFlag, '--force-with-lease');
});

test('legacy publication retains the candidate commit when pushing fails', async t => {
  const {events, result} = await publish(false, {sync: true, failPush: true});
  t.deepEqual(result, {commit: 'candidate-commit', branch: 'update-node-api-v24.10', error: 'push failed'});
  t.false(events.some(event => ['post', 'patch'].includes(event[0])));
});

for (const scenario of [
  {name: 'creation rejection', options: {createStatus: 403}, error: 'creation failed'},
  {name: 'existing PR lookup failure', existing: true, options: {searchStatus: 500}, error: 'search failed'},
  {name: 'missing existing PR', existing: true, options: {noMatch: true}, error: 'Could not create or find PR'},
  {name: 'metadata rejection', options: {patchStatus: 403}, error: 'metadata failed'}
]) {
  test(`publication reports ${scenario.name}`, async t => {
    const {events, error, result} = await publish(Boolean(scenario.existing), scenario.options);
    t.true(error.includes(scenario.error));
    t.is(result, undefined);
    if (scenario.options.patchStatus === undefined) t.false(events.some(event => event[0] === 'patch'));
  });
}

for (const reviewStatus of [201, 403]) {
  test(`reviewer assignment status ${reviewStatus} preserves successful publication`, async t => {
    const {events, result, stdout} = await publish(false, {reviewStatus});
    t.is(result.pullRequest.number, 10);
    const review = events.find(event => event[0] === 'post' && event[1].endsWith('/requested_reviewers'));
    t.deepEqual(review[2].json, {reviewers: ['reviewer'], team_reviewers: ['team']});
    t.deepEqual(events.find(event => event[0] === 'patch')[2].json.labels, ['keep-me', 'upgrade']);
    if (reviewStatus === 403) t.regex(stdout, /Issue occurred while adding reviewers.*review request failed/);
  });
}

test('an unchanged legacy upgrade does not resolve a commit or publish a PR', async t => {
  const {events, result} = await publish(false, {sync: true, noChanges: true});
  t.deepEqual(result, {commit: null, branch: 'update-node-api-v24.10'});
  t.deepEqual(events, [['commit', 'update-node-api-v24.10', 'Upgrade Node', 'master']]);
});
