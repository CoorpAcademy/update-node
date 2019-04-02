const executeScript = require('./script');

const commitFiles = (branch, message) =>
  executeScript([
    branch && `git checkout -b ${branch} || (git branch -D ${branch} && git checkout -b ${branch})`,
    // make it an option
    'git add .',
    `git commit -m "${message}" ${branch && ';exit_status=$?; git checkout -; exit $exit_status'}`
  ])
    .tap(() => {
      process.stdout.write('+ Commit files\n');
      return true;
    })
    .tapCatch(() => {
      process.stderr.write('+ Nothing to commit\n');
      return false;
    });

const pushFiles = (branch, message, githubToken, repoSlug) =>
  executeScript([
    `git config remote.gh.url >/dev/null || git remote add gh https://${githubToken}@github.com/${repoSlug}.git`,
    `git push gh ${branch}:refs/heads/${branch} --force || (git remote remove gh && exit 12)`,
    'git remote remove gh'
  ]).tap(() => process.stdout.write(`+ Push files on ${branch}\n`));

module.exports = {
  commitFiles,
  pushFiles
};
