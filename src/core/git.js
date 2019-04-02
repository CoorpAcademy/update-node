const executeScript = require('./script');

const commitFiles = (branch, message) =>
  executeScript([
    branch && `git checkout -b ${branch} || git branch -D ${branch} && git checkout -b ${branch}`,
    // make it an option
    'git add .',
    `git commit -m "${message}"`,
    branch && 'git checkout -'
  ])
    .tap(() => {
      process.stdout.write('Commit files\n');
      return true;
    })
    .tapCatch(() => {
      process.stderr.write('Nothing to commit\n');
      return false;
    });

const pushFiles = (branch, message, githubToken, repoSlug) =>
  executeScript([
    `git remote add gh https://${githubToken}@github.com/${repoSlug}.git`,
    `git push gh ${branch}:refs/heads/${branch} --force-with-lease`
  ]).tap(() => process.stdout.write(`Push files on ${branch}\n`));

module.exports = {
  commitFiles,
  pushFiles
};
