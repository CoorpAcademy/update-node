const executeScript = require('./script');

const commitFiles = (branch, message) =>
  executeScript(
    `
    git checkout -b ${branch}
    git add .
    git commit -m "${message}"
    git checkout -
    `
  )
    .tap(() => process.stdout.write('Commit files\n'))
    .tapCatch(() => process.stderr.write('Nothing to commit\n'));

const pushFiles = (branch, message, githubToken, repoSlug) =>
  executeScript(
    `
    git remote add gh https://${githubToken}@github.com/${repoSlug}.git
    git push gh ${branch}:refs/heads/${branch} --force-with-lease
    `
  ).tap(() => process.stdout.write(`Push files on ${branch}\n`));

module.exports = {
  commitFiles,
  pushFiles
};
