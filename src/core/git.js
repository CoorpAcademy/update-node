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
      `git commit -m "${message}" ${branch && ';exit_status=$?; git checkout -; exit $exit_status'}`
    ]);
    process.stdout.write('+ Commit files\n');
    return true;
  } catch (er) {
    process.stderr.write('+ Nothing to commit\n');
    return false;
  }
};

const headCommit = () => {
  const res = shelljs.exec('git rev-parse --short HEAD');
  return res.stdout;
}

const pushFiles = (branch, message, githubToken, repoSlug) =>
  executeScript([
    `git config remote.gh.url >/dev/null || git remote add gh https://${githubToken}@github.com/${repoSlug}.git`,
    `git push gh ${branch}:refs/heads/${branch} --force || (git remote remove gh && exit 12)`,
    'git remote remove gh'
  ]).tap(() => process.stdout.write(`+ Push files on ${c.yellow.bold(branch)}\n`));

module.exports = {
  commitFiles,
  pushFiles,
  headCommit
};
