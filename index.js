'use strict';

/**
 * index.js — WinCC OA JavaScript Manager entry point.
 *
 * Starts the Express i3X REST API server and registers WinCC OA lifecycle hooks:
 *  - sysConnect listeners for DP/type changes → cache invalidation
 *  - registerExitCallback for graceful shutdown
 */

const { WinccoaManager, WinccoaSysConEvent } = require('winccoa-manager');
const { createApp } = require('./server');
const config = require('./config');
const { invalidateCache } = require('./mapping/hierarchy');

const winccoa = new WinccoaManager();

async function main() {
  console.info('=== WinCC OA i3X Server starting ===');
  console.info(`Config: port=${config.port}, basePath=${config.basePath}, auth=${config.auth.enabled}`);

  // ── Start Express server ────────────────────────────────────────────────
  const app = createApp();
  const server = app.listen(config.port, config.host || '0.0.0.0', () => {
    console.info(`i3X API server listening on ${config.host || '0.0.0.0'}:${config.port}${config.basePath}`);
  });

  server.on('error', (err) => {
    console.error('HTTP server error:', err);
  });

  // ── Cache invalidation on DP/type events ────────────────────────────────
  // sysConnect is an EventEmitter — subscribe per event name.
  try {
    const invalidate = () => invalidateCache();
    winccoa.sysConnect.on(WinccoaSysConEvent.DpCreated,     invalidate);
    winccoa.sysConnect.on(WinccoaSysConEvent.DpDeleted,     invalidate);
    winccoa.sysConnect.on(WinccoaSysConEvent.DpTypeCreated, invalidate);
    winccoa.sysConnect.on(WinccoaSysConEvent.DpTypeChanged, invalidate);
    winccoa.sysConnect.on(WinccoaSysConEvent.DpTypeDeleted, invalidate);
    console.info('sysConnect listeners registered for cache invalidation');
  } catch (exc) {
    console.warn('sysConnect registration failed (non-fatal):', String(exc));
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────
  process.prependListener('exit', () => {
    console.info('WinCC OA manager exiting — closing HTTP server');
    server.close();
  });

  console.info('i3X Server ready');
}

void main();
