'use strict';

/**
 * routes/subscriptions.js
 *
 * Subscription CRUD + SSE stream + sync.
 *
 * Routes:
 *   GET    /subscriptions                     — list all
 *   POST   /subscriptions                     — create
 *   GET    /subscriptions/:id                 — get one
 *   DELETE /subscriptions/:id                 — delete
 *   POST   /subscriptions/:id/register        — add monitored items
 *   POST   /subscriptions/:id/unregister      — remove monitored items
 *   GET    /subscriptions/:id/stream          — SSE event stream
 *   POST   /subscriptions/:id/sync            — poll + clear queue
 */

const express = require('express');
const manager = require('../subscriptions/manager');
const monitor = require('../subscriptions/monitor');
const { setupSse } = require('../subscriptions/sse');
const { elementIdToDpe, buildObjectInstanceList } = require('../mapping/hierarchy');
const { sendError } = require('../utils/errors');

const router = express.Router();

// ── List ──────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.json({ subscriptions: manager.listSubscriptions() });
});

// ── Create ────────────────────────────────────────────────────────────────

router.post('/', (_req, res) => {
  const id = manager.createSubscription();
  res.status(201).json({ subscriptionId: id });
});

// ── Get one ───────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const sub = manager.getSubscription(req.params.id);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${req.params.id}`);
  res.json(manager.serializeSub(sub));
});

// ── Delete ────────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const deleted = manager.deleteSubscription(req.params.id, monitor);
  if (!deleted) return sendError(res, 404, 'Subscription not found', `id=${req.params.id}`);
  res.status(204).end();
});

// ── Register monitored items ──────────────────────────────────────────────

/**
 * POST /subscriptions/:id/register
 * Body: { elementIds: string[], maxDepth?: number }
 *
 * Resolves each elementId → DPE (recursively if maxDepth > 1),
 * then calls dpConnect for each leaf DPE.
 */
router.post('/:id/register', async (req, res) => {
  const sub = manager.getSubscription(req.params.id);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${req.params.id}`);

  const { elementIds, maxDepth = 1 } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }

  try {
    // Expand to leaf DPEs
    const leafIds = await resolveLeafIds(elementIds, maxDepth);

    const registered = [];
    for (const eid of leafIds) {
      if (sub.monitoredItems.has(eid)) continue;  // already watching

      const dpe = await elementIdToDpe(eid);
      if (!dpe) {
        console.warn('register: no DPE for elementId', eid);
        continue;
      }

      const connectId = monitor.connect(req.params.id, eid, dpe);
      sub.monitoredItems.set(eid, { dpeName: dpe, connectId, maxDepth });
      registered.push(eid);
    }

    res.json({ registered });
  } catch (exc) {
    console.error('POST /subscriptions/:id/register failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// ── Unregister monitored items ────────────────────────────────────────────

/**
 * POST /subscriptions/:id/unregister
 * Body: { elementIds: string[] }
 */
router.post('/:id/unregister', (req, res) => {
  const sub = manager.getSubscription(req.params.id);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${req.params.id}`);

  const { elementIds } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }

  const unregistered = [];
  for (const eid of elementIds) {
    const item = sub.monitoredItems.get(eid);
    if (!item) continue;
    monitor.disconnect(item.connectId);
    sub.monitoredItems.delete(eid);
    unregistered.push(eid);
  }

  res.json({ unregistered });
});

// ── SSE stream ────────────────────────────────────────────────────────────

/**
 * GET /subscriptions/:id/stream
 * Keeps the connection open and pushes SSE events as DPE values change.
 */
router.get('/:id/stream', (req, res) => {
  const sub = manager.getSubscription(req.params.id);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${req.params.id}`);

  const heartbeat = setupSse(res);
  manager.addSseClient(req.params.id, res);

  // Flush any already-queued items to the new client
  const queued = manager.drainQueue(req.params.id);
  if (queued && queued.length > 0) {
    res.write(`data: ${JSON.stringify(queued)}\n\n`);
  }

  // Clean up when the client disconnects
  req.on('close', () => {
    clearInterval(heartbeat);
    manager.removeSseClient(req.params.id, res);
  });
});

// ── Sync (poll) ───────────────────────────────────────────────────────────

/**
 * POST /subscriptions/:id/sync
 * Returns and clears the queued value updates.
 */
router.post('/:id/sync', (req, res) => {
  const items = manager.drainQueue(req.params.id);
  if (items === null) {
    return sendError(res, 404, 'Subscription not found', `id=${req.params.id}`);
  }
  res.json({ data: items });
});

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve elementIds to leaf DPE elementIds, expanding up to maxDepth levels.
 */
async function resolveLeafIds(elementIds, maxDepth) {
  if (maxDepth <= 1) return elementIds;

  const all = await buildObjectInstanceList();
  const result = new Set();

  function expand(ids, depth) {
    for (const eid of ids) {
      const children = all.filter(o => o.parentId === eid);
      if (children.length === 0 || depth <= 1) {
        result.add(eid);
      } else {
        expand(children.map(c => c.elementId), depth - 1);
      }
    }
  }

  expand(elementIds, maxDepth);
  return [...result];
}

module.exports = router;
