'use strict';

const { WinccoaManager, WinccoaError } = require('winccoa-manager');
const config = require('./config');

const winccoa = new WinccoaManager();

/**
 * Basic Auth middleware for Express.
 * Validates credentials against WinCC OA user management.
 * Can be disabled via config.auth.enabled = false (for development).
 */
async function basicAuth(req, res, next) {
  if (!config.auth.enabled) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="i3X API"');
    return res.status(401).json({ error: { code: 401, message: 'Authentication required' } });
  }

  let username, password;
  try {
    const b64 = authHeader.slice('Basic '.length);
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) throw new Error('no colon');
    username = decoded.slice(0, colonIdx);
    password = decoded.slice(colonIdx + 1);
  } catch (_err) {
    return res.status(401).json({ error: { code: 401, message: 'Malformed Authorization header' } });
  }

  // getUserId returns undefined for unknown users, a number (>= 0) for known users.
  // Root user has id=0, so we must not use <= 0 as the "unknown" check.
  const userId = winccoa.getUserId(username);
  if (userId === undefined || userId === null) {
    console.warn(`Auth: login failed — unknown user "${username}" from ${req.ip}`);
    return res.status(401).json({ error: { code: 401, message: 'Invalid credentials' } });
  }

  try {
    // Pass password only when non-empty — WinCC OA users without a password
    // must be validated with setUserId(id) (no second argument).
    const ok = password ? winccoa.setUserId(userId, password) : winccoa.setUserId(userId);
    if (!ok) {
      console.warn(`Auth: login failed — wrong password for user "${username}" (id=${userId}) from ${req.ip}`);
      return res.status(401).json({ error: { code: 401, message: 'Invalid credentials' } });
    }
    console.info(`Auth: login OK — user "${username}" (id=${userId}) from ${req.ip} ${req.method} ${req.path}`);
    req.winccoaUser = { userId, username };
    return next();
  } catch (exc) {
    if (exc instanceof WinccoaError) {
      console.warn(`Auth: login failed — WinCC OA rejected user "${username}" (id=${userId}) from ${req.ip}: ${exc.message}`);
    } else {
      console.error(`Auth: unexpected exception for user "${username}" from ${req.ip}:`, exc);
    }
    return res.status(401).json({ error: { code: 401, message: 'Invalid credentials' } });
  }
}

module.exports = { basicAuth };
