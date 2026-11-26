const test = require('ava').default;
const {execa} = require('execa');
const stripAnsi = require('strip-ansi').default;
const {reportClusterDetails} = require('../src/bump-dependencies');

test('cluster summaries report publication failures and retain successful clusters', t => {
  const output = [];
  const write = process.stdout.write;
  process.stdout.write = chunk => {
    output.push(chunk);
    return true;
  };
  let errors;
  try {
    errors = reportClusterDetails([
      {branch: 'update-dependencies-core', error: new Error('stale info')},
      {branch: 'update-dependencies-test', pullRequest: {html_url: 'https://example.invalid/pull/2'}}
    ]);
  } finally {
    process.stdout.write = write;
  }

  t.deepEqual(errors, [{branch: 'update-dependencies-core', error: 'stale info'}]);
  const summary = stripAnsi(output.join(''));
  t.regex(summary, /update-dependencies-core: publication failed: stale info/);
  t.regex(summary, /update-dependencies-test: https:\/\/example\.invalid\/pull\/2/);
});

test('dependency publication errors retain successful cluster output and fail the command', async t => {
  const packageModule = require.resolve('../src/updatees/package');
  const gitModule = require.resolve('../src/core/git');
  const githubModule = require.resolve('../src/core/github');
  const bumpModule = require.resolve('../src/bump-dependencies');
  const {exitCode, stdout} = await execa(process.execPath, [
    '-e',
    `
      const packages = require(${JSON.stringify(packageModule)});
      packages.updateDependencies = async (pkg, dependencies) => [[dependencies[0], '1.0.0', '2.0.0']];
      packages.updateDevDependencies = async () => [];
      packages.updateLock = async () => {};
      require(${JSON.stringify(gitModule)}).currentUser = async () => 'generator';
      require(${JSON.stringify(githubModule)}).syncGithub = async (repo, base, branch) =>
        branch.endsWith('broken')
          ? {branch, commit: 'candidate', error: new Error('push rejected')}
          : {branch, commit: 'candidate', pullRequest: {html_url: 'https://example.invalid/good'}};
      require(${JSON.stringify(bumpModule)})(
        {
          dependencies: [
            {name: 'broken', dependencies: ['dep-broken']},
            {name: 'good', dependencies: ['dep-good']}
          ],
          package: 'fixture', packageManager: 'npm', baseBranch: 'master', repoSlug: 'org/repo',
          token: 'token', forceFlag: '--force-with-lease', reviewers: [], teamReviewers: [], argv: {}
        }
      ).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      });
    `
  ], {reject: false});

  t.is(exitCode, 1);
  const output = stripAnsi(stdout);
  t.regex(output, /update-dependencies-broken: publication failed: push rejected/);
  t.regex(output, /update-dependencies-good: https:\/\/example\.invalid\/good/);
});
