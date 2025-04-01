const {sync: execSync} = require('execa');
const {executeScript} = require('./script');

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

const headCommit = () => execSync('git', ['rev-parse', '--short', 'HEAD']).stdout;
const headMessage = () => execSync('git', ['log', '-1', '--pretty=%B']).stdout;
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
    `if git rev-parse --abbrev-ref --symbolic-full-name ${branch} ; then git pull; fi`, // pull only if upstream
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
  executeScript([
    `git config remote.gh.url >/dev/null || git remote add gh https://${githubToken}@github.com/${repoSlug}.git`,
    `(git push gh ${branch}:refs/heads/${branch} ${forceFlag} ${
      tags ? '&& git push gh --tags)' : ')'
    }|| (git remote remove gh && exit 12)`,
    'git remote remove gh'
  ]);

module.exports = {
  commitFiles,
  pushFiles,
  headCommit,
  headBranch,
  headMessage,
  headClean,
  getRepoSlug,
  currentUser,
  cleanAndSyncRepo
};
