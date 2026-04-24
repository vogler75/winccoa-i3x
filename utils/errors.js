'use strict';

/**
 * Send a standardised i3X v1 error response:
 *   { success: false, error: { code, message } }
 *
 * @param {import('express').Response} res
 * @param {number} status  HTTP status code
 * @param {string} message Short human-readable message
 * @param {string} [details] Optional extra detail — appended to message if given
 */
function sendError(res, status, message, details) {
  const fullMessage = details !== undefined ? `${message}: ${details}` : message;
  res.status(status).json({ success: false, error: { code: status, message: fullMessage } });
}

module.exports = { sendError };
