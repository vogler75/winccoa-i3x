'use strict';

/**
 * routes/subscriptions.js — i3X v1 subscription routes.
 *
 *   POST /subscriptions            create
 *   POST /subscriptions/register   add monitored items
 *   POST /subscriptions/unregister remove monitored items
 *   POST /subscriptions/stream     open SSE stream (POST, body carries subId)
 *   POST /subscriptions/sync       poll + ack
 *   POST /subscriptions/list       bulk fetch details
 *   POST /subscriptions/delete     bulk delete
 */

const express = require('express');
const manager = require('../subscriptions/manager');
const monitor = require('../subscriptions/monitor');
const { setupSse } = require('../subscriptions/sse');
const { getObjectValueInfo } = require('../mapping/hierarchy');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const router = express.Router();

// ── Create ────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { clientId, displayName } = req.body || {};
  const subscriptionId = manager.createSubscription({ clientId, displayName });
  sendSuccess(res, { clientId: clientId || null, subscriptionId, displayName: displayName || null });
});

// ── Register monitored items ──────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { subscriptionId, elementIds, maxDepth = 1 } = req.body || {};
  if (!subscriptionId) {
    return sendError(res, 400, 'Validation error', '"subscriptionId" is required');
  }
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  const sub = manager.getSubscription(subscriptionId);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${subscriptionId}`);

  try {
    const items = [];
    for (const eid of elementIds) {
      if (sub.monitoredItems.has(eid)) {
        items.push(bulkItem({ elementId: eid, subscriptionId }));
        continue;
      }
      const info = await getObjectValueInfo(eid);
      if (!info) {
        items.push(bulkItem({
          elementId: eid,
          subscriptionId,
          error: { code: 404, message: `Object '${eid}' is not monitorable (folder or unknown)` },
        }));
        continue;
      }
      const connectId = await monitor.connect(subscriptionId, eid);
      if (connectId === null) {
        items.push(bulkItem({
          elementId: eid,
          subscriptionId,
          error: { code: 404, message: `Object '${eid}' has no monitorable DPE leaves` },
        }));
        continue;
      }
      sub.monitoredItems.set(eid, { connectId, maxDepth });
      items.push(bulkItem({ elementId: eid, subscriptionId }));
    }
    sendBulk(res, items);
  } catch (exc) {
    console.error('POST /subscriptions/register failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// ── Unregister ────────────────────────────────────────────────────────────

router.post('/unregister', async (req, res) => {
  const { subscriptionId, elementIds } = req.body || {};
  if (!subscriptionId) {
    return sendError(res, 400, 'Validation error', '"subscriptionId" is required');
  }
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  const sub = manager.getSubscription(subscriptionId);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${subscriptionId}`);

  for (const eid of elementIds) {
    const item = sub.monitoredItems.get(eid);
    if (!item) continue;
    monitor.disconnect(item.connectId);
    sub.monitoredItems.delete(eid);
  }
  const items = elementIds.map(eid => bulkItem({ elementId: eid, subscriptionId }));
  sendBulk(res, items);
});

// ── Stream (SSE over POST) ────────────────────────────────────────────────

router.post('/stream', (req, res) => {
  const { subscriptionId } = req.body || {};
  if (!subscriptionId) {
    return sendError(res, 400, 'Validation error', '"subscriptionId" is required');
  }
  const sub = manager.getSubscription(subscriptionId);
  if (!sub) return sendError(res, 404, 'Subscription not found', `id=${subscriptionId}`);

  const heartbeat = setupSse(res);
  manager.addSseClient(subscriptionId, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    manager.removeSseClient(subscriptionId, res);
  });
});

// ── Sync (poll + ack) ─────────────────────────────────────────────────────

router.post('/sync', (req, res) => {
  const { subscriptionId, lastSequenceNumber } = req.body || {};
  if (!subscriptionId) {
    return sendError(res, 400, 'Validation error', '"subscriptionId" is required');
  }
  const updates = manager.syncUpdates(subscriptionId, lastSequenceNumber);
  if (updates === null) {
    return sendError(res, 404, 'Subscription not found', `id=${subscriptionId}`);
  }
  sendSuccess(res, updates);
});

// ── List (bulk) ───────────────────────────────────────────────────────────

router.post('/list', (req, res) => {
  const { subscriptionIds } = req.body || {};
  if (!Array.isArray(subscriptionIds)) {
    return sendError(res, 400, 'Validation error', '"subscriptionIds" array is required');
  }
  const items = subscriptionIds.map(subId => {
    const sub = manager.getSubscription(subId);
    if (sub) return bulkItem({ subscriptionId: subId, result: manager.serializeDetail(sub) });
    return bulkItem({
      subscriptionId: subId,
      error: { code: 404, message: `Subscription '${subId}' not found` },
    });
  });
  sendBulk(res, items);
});

// ── Delete (bulk) ─────────────────────────────────────────────────────────

router.post('/delete', (req, res) => {
  const { subscriptionIds } = req.body || {};
  if (!Array.isArray(subscriptionIds)) {
    return sendError(res, 400, 'Validation error', '"subscriptionIds" array is required');
  }
  const items = subscriptionIds.map(subId => {
    const ok = manager.deleteSubscription(subId, monitor);
    if (ok) return bulkItem({ subscriptionId: subId });
    return bulkItem({
      subscriptionId: subId,
      error: { code: 404, message: `Subscription '${subId}' not found` },
    });
  });
  sendBulk(res, items);
});

module.exports = router;
