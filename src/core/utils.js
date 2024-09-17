const _ = require('lodash/fp');

const makeError = (message, options = {}) => {
  const error = new Error(message.message || message);
  error.exitCode = message.exitCode || options.exitCode;
  error.details = message.details || options.details;
  return error;
};

const formatEventualSuffix = text => (_.isEmpty(text) ? '' : `\n\n\n-----\n${text}`);

module.exports = {makeError, formatEventualSuffix};
