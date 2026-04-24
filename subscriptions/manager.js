'use strict';

/**
 * subscriptions/manager.js — i3X v1 subscription store.
 *
 * Each subscription has:
 *   - id (UUID)
 *   - clientId       — caller-provided, echoed on responses
 *   - displayName    — caller-provided, optional
 *   - created (Date)
 *   - monitoredItems: Map<elementId, { dpeName, connectId, maxDepth }>
 *   - updateQueue:   Array<SyncUpdate>   — queued for /sync, bounded to MAX_QUEUE_SIZE
 *   - nextSequence:  number              — monotonic per-subscription counter
 *   - sseClients:    Set<Response>
 */

const { randomUUID } = require('crypto');

const MAX_QUEUE_SIZE = 10_000;

/** @type {Map<string, Subscription>} */
const _subscriptions = new Map();

function createSubscription({ clientId, displayName } = {}) {
  const id = randomUUID();
  _subscriptions.set(id, {
    id,
    clientId: clientId || null,
    displayName: displayName || null,
    created: new Date(),
    monitoredItems: new Map(),
    updateQueue: [],
    nextSequence: 1,
    sseClients: new Set(),
  });
  return id;
}

function getSubscription(id) {
  return _subscriptions.get(id) || null;
}

function deleteSubscription(id, monitor) {
  const sub = _subscriptions.get(id);
  if (!sub) return false;
  for (const [, item] of sub.monitoredItems) {
    monitor.disconnect(item.connectId);
  }
  sub.monitoredItems.clear();
  for (const res of sub.sseClients) {
    try { res.end(); } catch (_e) { /* ignore */ }
  }
  sub.sseClients.clear();
  _subscriptions.delete(id);
  return true;
}

/**
 * Assign a sequence number to an update, push to SSE streams, and enqueue
 * for /sync callers.
 *
 * @param {string} id  subscriptionId
 * @param {string} elementId
 * @param {{value, quality, timestamp}} vqt
 */
function pushUpdate(id, elementId, vqt) {
  const sub = _subscriptions.get(id);
  if (!sub) return;

  const update = {
    sequenceNumber: sub.nextSequence++,
    elementId,
    value: vqt.value,
    quality: vqt.quality,
    timestamp: vqt.timestamp,
  };

  sub.updateQueue.push(update);
  if (sub.updateQueue.length > MAX_QUEUE_SIZE) {
    sub.updateQueue.splice(0, sub.updateQueue.length - MAX_QUEUE_SIZE);
  }

  const payload = `data: ${JSON.stringify(update)}\n\n`;
  for (const res of sub.sseClients) {
    try {
      res.write(payload);
    } catch (err) {
      console.warn('SSE write error — removing client:', err.message);
      sub.sseClients.delete(res);
    }
  }
}

/**
 * Sync pull with ack:
 *  - Drops queued updates with sequenceNumber <= lastSequenceNumber.
 *  - Returns the remaining updates, ordered by sequenceNumber.
 *
 * @param {string} id
 * @param {number|null|undefined} lastSequenceNumber
 * @returns {SyncUpdate[] | null}   null if the subscription does not exist
 */
function syncUpdates(id, lastSequenceNumber) {
  const sub = _subscriptions.get(id);
  if (!sub) return null;
  if (typeof lastSequenceNumber === 'number') {
    const keepFrom = sub.updateQueue.findIndex(u => u.sequenceNumber > lastSequenceNumber);
    if (keepFrom === -1) {
      sub.updateQueue.length = 0;
    } else if (keepFrom > 0) {
      sub.updateQueue.splice(0, keepFrom);
    }
  }
  return sub.updateQueue.slice();
}

function addSseClient(id, res) {
  const sub = _subscriptions.get(id);
  if (!sub) return false;
  sub.sseClients.add(res);
  return true;
}

function removeSseClient(id, res) {
  const sub = _subscriptions.get(id);
  if (!sub) return;
  sub.sseClients.delete(res);
}

/**
 * v1 SubscriptionDetail shape.
 */
function serializeDetail(sub) {
  const monitoredObjects = [];
  for (const [elementId, item] of sub.monitoredItems) {
    monitoredObjects.push({ elementId, maxDepth: item.maxDepth });
  }
  return {
    subscriptionId: sub.id,
    clientId: sub.clientId,
    displayName: sub.displayName,
    monitoredObjects,
  };
}

module.exports = {
  createSubscription,
  getSubscription,
  deleteSubscription,
  pushUpdate,
  syncUpdates,
  addSseClient,
  removeSseClient,
  serializeDetail,
};
