'use strict';

/**
 * Send a standardised i3X error response.
 * @param {import('express').Response} res
 * @param {number} status  HTTP status code
 * @param {string} message Short human-readable message
 * @param {string} [details] Optional extra detail
 */
function sendError(res, status, message, details) {
  const body = { error: { code: status, message } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}

module.exports = { sendError };
