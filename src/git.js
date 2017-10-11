const executeScript = require('./script');

const commitFiles = message =>
  executeScript(
    `
    git add .
    git commit -m "${message}"
    `
  )
    .tap(() => process.stdout.write('Commit files\n'))
    .tapCatch(() => process.stderr.write('Nothing to commit\n'));

const pushFiles = (head, message, githubToken, repoSlug) =>
  executeScript(
    `
    git remote add gh https://${githubToken}@github.com/${repoSlug}.git
    git push gh HEAD:refs/heads/${head} -f
    `
  ).tap(() => process.stdout.write(`Push files on ${head}\n`));

module.exports = {
  commitFiles,
  pushFiles
};
