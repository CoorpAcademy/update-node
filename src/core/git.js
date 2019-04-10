const c = require('chalk');
const shelljs = require('shelljs');
const executeScript = require('./script');

const commitFiles = async (branch, message) => {
  try {
    await executeScript([
      branch &&
        `git checkout -b ${branch} || (git branch -D ${branch} && git checkout -b ${branch})`,
      // make it an option
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

const headCommit = () => {
  const res = shelljs.exec('git rev-parse --short HEAD', {silent: true});
  return res.stdout.trim();
};

const headMessage = () => {
  const res = shelljs.exec('git log -1 --pretty=%B', {silent: true});
  return res.stdout.trim();
};
const headBranch = () => {
  const res = shelljs.exec('git symbolic-ref --short HEAD', {silent: true});
  return res.stdout.trim();
};
const headClean = () => {
  const res = shelljs.exec('git status', {silent: true});
  return /nothing to commit, working tree clean/.test(res.stdout);
};

const getRepoSlug = () => {
  const res = shelljs.exec('git remote get-url origin', {silent: true});
  return res.stdout
    .split(':')[1]
    .trim()
    .replace(/\.git$/, '');
};

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
