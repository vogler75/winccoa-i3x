'use strict';

/**
 * i3X v1 response-envelope helpers.
 *
 * Single:  { success: true,  result: <T> }
 * Bulk:    { success: <all items succeeded>, results: [ { success, elementId|subscriptionId, result|error } ] }
 * Error:   { success: false, error: { code, message } }
 */

function success(result) {
  return { success: true, result: result === undefined ? null : result };
}

function bulk(results) {
  return { success: results.every(item => item && item.success === true), results };
}

function bulkItem({ elementId, subscriptionId, result, error }) {
  const item = { success: !error };
  if (elementId !== undefined) item.elementId = elementId;
  if (subscriptionId !== undefined) item.subscriptionId = subscriptionId;
  if (!error) item.result = result === undefined ? null : result;
  if (error !== undefined) item.error = error;
  return item;
}

function sendSuccess(res, result) {
  res.json(success(result));
}

function sendBulk(res, results) {
  res.json(bulk(results));
}

function sendError(res, status, message) {
  res.status(status).json({ success: false, error: { code: status, message } });
}

module.exports = { success, bulk, bulkItem, sendSuccess, sendBulk, sendError };
