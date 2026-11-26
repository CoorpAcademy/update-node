const {randomUUID} = require('crypto');
const {execaSync: execSync} = require('execa');
const {executeScript} = require('./script');

const pushDestination = () => {
  const result = execSync('git', ['remote', 'get-url', '--push', '--all', 'gh'], {reject: false});
  const destinations = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (result.exitCode !== 0 || destinations.length !== 1)
    throw new Error('Could not resolve a single GitHub push destination');
  return destinations[0];
};

const remoteBranchTip = (branch, destination) => {
  const ref = `refs/heads/${branch}`;
  const result = execSync('git', ['ls-remote', '--exit-code', destination, ref], {reject: false});
  if (result.exitCode === 2 && !result.stdout) return '';
  if (result.exitCode !== 0) throw new Error(`Could not read remote branch ${branch}`);
  const [oid, remoteRef] = result.stdout.trim().split(/\s+/);
  if (remoteRef !== ref || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(oid || ''))
    throw new Error(`Could not read remote branch ${branch}`);
  return oid;
};

const verifyDiscardedCommitAuthors = (branch, expectedOid, candidateRef, destination) => {
  if (!expectedOid) return;
  const tempRef = `refs/update-node/lease/${randomUUID()}`;
  try {
    try {
      execSync('git', ['fetch', '--quiet', destination, `+refs/heads/${branch}:${tempRef}`]);
    } catch {
      throw new Error(`Could not inspect authorship of remote branch ${branch}`);
    }
    const fetchedOid = execSync('git', ['rev-parse', tempRef]).stdout.trim();
    if (fetchedOid !== expectedOid)
      throw new Error(`Remote branch ${branch} changed while checking its ownership`);
    const discarded = execSync('git', [
      'rev-list',
      expectedOid,
      '--not',
      candidateRef
    ]).stdout.trim();
    if (!discarded) return;
    const configuredName = execSync('git', ['config', 'user.name'], {reject: false}).stdout.trim();
    const configuredEmail = execSync('git', ['config', 'user.email'], {
      reject: false
    }).stdout.trim();
    if (!configuredName || !configuredEmail)
      throw new Error(
        `Cannot verify authorship of commits on ${branch}: generator identity is not configured`
      );
    const authors = execSync('git', [
      'log',
      '--format=%an%x00%ae',
      expectedOid,
      '--not',
      candidateRef
    ])
      .stdout.trim()
      .split('\n');
    const foreignAuthor = authors.some(author => {
      const [name, email] = author.split('\0');
      return name !== configuredName || email !== configuredEmail;
    });
    if (foreignAuthor)
      throw new Error(
        `Skipping ${branch}: its commits include an author other than the configured generator`
      );
  } finally {
    execSync('git', ['update-ref', '-d', tempRef], {reject: false});
  }
};

const commitFiles = async (branch, message, baseBranch = 'master') => {
  try {
    await executeScript([
      branch &&
        `git checkout -b ${branch} ${baseBranch} || (git branch -D ${branch} && git checkout -b ${branch} ${baseBranch})`,
      'git add --update .',
      `git commit -m "${message}"${
        branch ? ' ;exit_status=$?; git checkout -; exit $exit_status' : ''
      }`
    ]);
    process.stdout.write('+ Commit files 💾\n');
    return true;
  } catch (er) {
    process.stderr.write('+ Nothing to commit 🤷‍\n');
    return false;
  }
};

const headCommit = (ref = 'HEAD') => execSync('git', ['rev-parse', '--short', ref]).stdout;
const headMessage = () => execSync('git', ['log', '-1', '--pretty=%B']).stdout;
const commitDetails = (ref = 'HEAD') => {
  const {stdout} = execSync('git', ['show', '--no-patch', '--format=%H%n%T%n%P%n%B', ref]);
  const [sha, tree, parents, ...message] = stdout.split('\n');
  return {sha, tree, parents: parents.split(' ').filter(Boolean), message: message.join('\n')};
};
const headBranch = () => execSync('git', ['symbolic-ref', '--short', 'HEAD']).stdout;
const currentUser = () => execSync('git', ['config', '--global', 'user.name']).stdout;

const headClean = () => {
  return execSync('git', ['status', '--porcelain']).stdout === '';
};

const cleanAndSyncRepo = ({branch = 'master', preCleanCommand = [], postCleanCommand = []} = {}) =>
  executeScript([
    ...preCleanCommand,
    'git stash',
    `git checkout ${branch}`,
    `if git rev-parse --abbrev-ref --symbolic-full-name @{u} ; then git pull; fi`, // pull only if upstream
    ...postCleanCommand
  ]);

const getRepoSlug = () =>
  execSync('git', ['remote', 'get-url', 'origin'])
    .stdout.split(':')[1]
    .trim()
    .replace(/\.git$/, '');

const pushFiles = (
  branch,
  githubToken,
  repoSlug,
  {tags = false, forceFlag = '--force-with-lease'}
) =>
  (async () => {
    const configuredRemote =
      execSync('git', ['config', 'remote.gh.url'], {reject: false}).exitCode === 0;
    let remoteAdded = false;
    try {
      if (!configuredRemote) {
        try {
          await executeScript([
            `git remote add gh https://x-access-token:${githubToken}@github.com/${repoSlug}.git`
          ]);
          remoteAdded = true;
        } catch {
          throw new Error('Could not configure the GitHub remote');
        }
      }
      if (forceFlag === '--force') {
        await executeScript([
          `git push gh ${branch}:refs/heads/${branch} --force${tags ? ' && git push gh --tags' : ''}`
        ]);
        return;
      }
      const destination = pushDestination();
      const expectedOid = remoteBranchTip(branch, destination);
      verifyDiscardedCommitAuthors(branch, expectedOid, branch, destination);
      const lease = `--force-with-lease=refs/heads/${branch}:${expectedOid}`;
      await executeScript([
        `git push gh ${branch}:refs/heads/${branch} ${lease}${tags ? ' && git push gh --tags' : ''}`
      ]);
    } finally {
      if (remoteAdded) await executeScript(['git remote remove gh']);
    }
  })();

module.exports = {
  commitFiles,
  pushFiles,
  headCommit,
  headBranch,
  headMessage,
  commitDetails,
  headClean,
  getRepoSlug,
  currentUser,
  cleanAndSyncRepo
};
