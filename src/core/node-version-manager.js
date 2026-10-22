const {execa} = require('execa');
const {executeScript} = require('./script');
const {makeError} = require('./utils');

// Disable nvm's automatic activation while checking availability: the target
// .nvmrc is written after this check and may refer to a version not installed yet.
const SOURCE_NVM =
  'if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" --no-use || exit $?; fi'; // eslint-disable-line no-template-curly-in-string

const getNodeVersionRunner = async () => {
  const {stdout: manager} = await execa(
    `${SOURCE_NVM} > /dev/null\n` +
      'if command -v nvm > /dev/null 2>&1; then printf nvm; elif command -v n > /dev/null 2>&1; then printf n; fi',
    {shell: true}
  );
  if (!manager) throw makeError('No node version manager was found');

  const activate = manager === 'nvm' ? `${SOURCE_NVM}\n{ nvm use || nvm install; }` : 'n auto';

  // Keep activation and dependent commands in one shell, stopping at the first
  // failure while preserving nvm's PATH changes for every subsequent command.
  return commands =>
    executeScript([
      [activate, ...commands]
        .filter(Boolean)
        .map(cmd => `{\n${cmd}\n}`)
        .join(' &&\n')
    ]);
};

module.exports = {getNodeVersionRunner};
