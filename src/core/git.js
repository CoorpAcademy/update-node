const childProcess = require('child_process');
const executeScript = require('./script');

const commitFiles = async (branch, message) => {
  try {
    await executeScript([
      branch &&
        `git checkout -b ${branch} || (git branch -D ${branch} && git checkout -b ${branch})`,
      'git add .',
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

const headCommit = () =>
  childProcess.execFileSync('git', ['rev-parse', '--short', 'HEAD'], {encoding: 'utf-8'}).trim();
const headMessage = () =>
  childProcess.execFileSync('git', ['log', '-1', '--pretty=%B'], {encoding: 'utf-8'}).trim();
const headBranch = () =>
  childProcess.execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {encoding: 'utf-8'}).trim();

const headClean = () => {
  const res = childProcess.execFileSync('git', ['status'], {encoding: 'utf-8'});
  // only untracked
  return /nothing to commit/.test(res);
};

const getRepoSlug = () =>
  childProcess
    .execFileSync('git', ['remote', 'get-url', 'origin'], {encoding: 'utf-8'})
    .split(':')[1]
    .trim()
    .replace(/\.git$/, '');

const pushFiles = (branch, githubToken, repoSlug, tags = false) =>
  executeScript([
    `git config remote.gh.url >/dev/null || git remote add gh https://${githubToken}@github.com/${repoSlug}.git`,
    `(git push gh ${branch}:refs/heads/${branch} --force ${
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
  getRepoSlug
};
