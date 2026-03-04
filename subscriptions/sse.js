'use strict';

/**
 * subscriptions/sse.js
 *
 * SSE (Server-Sent Events) stream setup helpers.
 * Call setupSse(res) to configure headers and return a keep-alive interval.
 */

/**
 * Configure an Express Response for SSE streaming.
 * Sets headers and sends the initial comment to establish the connection.
 *
 * @param {object} res  Express Response object
 * @returns {NodeJS.Timeout} heartbeat interval — clear it when the client disconnects
 */
function setupSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
  res.flushHeaders();

  // Initial comment to open the connection
  res.write(': connected\n\n');

  // Heartbeat every 30 s to keep proxies from closing idle connections
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (_e) {
      clearInterval(heartbeat);
    }
  }, 30000);

  return heartbeat;
}

module.exports = { setupSse };
