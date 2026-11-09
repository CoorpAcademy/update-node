const test = require('ava').default;
const {getCleanupConfig} = require('../src/core/config');

test('repo override ignores local config and uses the target repository default branch', async t => {
  const requests = [];
  const config = await getCleanupConfig({repo: 'Other/Repo', token: 'fake', config: '/missing-config.json'}, {
    request: async (url, options) => {
      requests.push({url, options});
      return {body: {full_name: 'other/repo', default_branch: 'main'}};
    }
  });
  t.deepEqual(config, {repoSlug: 'other/repo', baseBranch: 'main', token: 'fake', local: false});
  t.is(requests[0].url, 'https://api.github.com/repos/Other/Repo');
  t.is(requests[0].options.headers.Authorization, 'token fake');
});

test('a local repo override requires no package, config, token or network lookup', async t => {
  const config = await getCleanupConfig({repo: 'other/repo', local: true}, {
    request: () => t.fail('Local mode must not call GitHub')
  });
  t.deepEqual(config, {repoSlug: 'other/repo', local: true, token: null});
});

for (const repo of ['', 'https://github.com/org/repo', 'org/repo/extra', 'org repo', 'org/.', 'org/..']) {
  test(`invalid repo override ${JSON.stringify(repo)} is rejected before network access`, async t => {
    await t.throwsAsync(getCleanupConfig({repo, token: 'fake'}, {
      request: () => t.fail('Invalid repository must not reach GitHub')
    }), {message: 'Repository must use owner/name format'});
  });
}

test('repo override fails clearly when authentication is unavailable', async t => {
  await t.throwsAsync(getCleanupConfig({repo: 'org/repo'}, {
    request: () => t.fail('Missing authentication must not reach GitHub')
  }), {message: 'A GitHub token is required to resolve the repository'});
});

test('repo lookup errors stop configuration resolution', async t => {
  await t.throwsAsync(getCleanupConfig({repo: 'org/missing', token: 'fake'}, {
    request: async () => { throw new Error('Repository not found'); }
  }), {message: 'Repository not found'});
});

test('a missing default branch cannot result in cleanup of an unscoped branch', async t => {
  await t.throwsAsync(getCleanupConfig({repo: 'org/repo', token: 'fake'}, {
    request: async () => ({body: {full_name: 'org/repo'}})
  }), {message: 'Could not resolve the repository default branch'});
});
