const {promises: fs} = require('fs');
const path = require('path');
const {execaSync} = require('execa');

const git = (args, options = {}) => execaSync('git', args, options);

const nodeUpgradeBase = (branch, cwd = process.cwd()) =>
  git(['rev-parse', '--verify', `${branch}^{commit}`], {cwd}).stdout;

const untrackedFiles = cwd =>
  git(['ls-files', '--others', '--exclude-standard', '-z'], {cwd})
    .stdout.split('\0')
    .filter(Boolean);

const onNodeBranch = async (branch, base, prepare, cwd = process.cwd()) => {
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], {cwd}).stdout;
  if (dirty) throw new Error('Node upgrade alternatives require a clean tracked working tree');
  git(['check-ref-format', '--branch', branch], {cwd});
  const original = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], {cwd, reject: false}).stdout;
  if (branch === original) throw new Error(`Cannot replace the current branch ${branch}`);
  const originalCommit = git(['rev-parse', 'HEAD'], {cwd}).stdout;
  const existingFiles = new Set(untrackedFiles(cwd));
  git(['switch', '-C', branch, base], {cwd});
  try {
    const details = await prepare();
    if (!details) return {branch, commit: null};
    // Commands may stage files themselves. Rebuild the index without including
    // files that were already untracked when this transaction began.
    git(['restore', '--source=HEAD', '--staged', '--', '.'], {cwd});
    git(['add', '--update', '--', '.'], {cwd});
    const created = untrackedFiles(cwd).filter(file => !existingFiles.has(file));
    if (created.length > 0) git(['add', '--', ...created], {cwd});
    if (git(['diff', '--cached', '--quiet'], {cwd, reject: false}).exitCode === 0)
      return {...details, branch, commit: null};
    git(['commit', '-m', details.message], {cwd});
    return {...details, branch, commit: git(['rev-parse', 'HEAD'], {cwd}).stdout};
  } finally {
    // The transaction began with no tracked edits. Restore only its own work;
    // pre-existing untracked files never enter the commit or cleanup set.
    try {
      git(['restore', '--source=HEAD', '--staged', '--', '.'], {cwd});
      git(['restore', '--source=HEAD', '--worktree', '--', '.'], {cwd});
      const created = untrackedFiles(cwd).filter(file => !existingFiles.has(file));
      await Promise.all(created.map(file => fs.rm(path.join(cwd, file), {force: true})));
    } finally {
      git(original ? ['switch', original] : ['switch', '--detach', originalCommit], {cwd});
    }
  }
};

module.exports = {nodeUpgradeBase, onNodeBranch};
