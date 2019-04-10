const makeError = (message, options = {}) => {
  const error = new Error(message.message || message);
  error.exitCode = message.exitCode || options.exitCode;
  error.details = message.details || options.details;
  return error;
};

module.exports = {makeError};
