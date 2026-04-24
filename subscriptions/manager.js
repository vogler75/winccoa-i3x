'use strict';

/**
 * subscriptions/manager.js
 *
 * In-memory subscription store.
 * Each subscription has:
 *   - id (UUID)
 *   - created (Date)
 *   - monitoredItems: Map<elementId, { dpeName, connectId, maxDepth }>
 *   - valueQueue: Array<SyncItem>  — for poll-based sync
 *   - sseClients: Set<Response>    — active SSE connections
 */

const { randomUUID } = require('crypto');

// Cap the /sync queue so a subscription that is never polled cannot grow
// the process memory without bound. Oldest entries are dropped first.
const MAX_QUEUE_SIZE = 10_000;

/** @type {Map<string, Subscription>} */
const _subscriptions = new Map();

/**
 * Create a new empty subscription.
 * @returns {string} subscriptionId
 */
function createSubscription() {
  const id = randomUUID();
  _subscriptions.set(id, {
    id,
    created: new Date(),
    monitoredItems: new Map(),
    valueQueue: [],
    sseClients: new Set(),
  });
  return id;
}

/**
 * Get a subscription by id. Returns null if not found.
 * @param {string} id
 * @returns {object|null}
 */
function getSubscription(id) {
  return _subscriptions.get(id) || null;
}

/**
 * List all subscriptions.
 * @returns {object[]}
 */
function listSubscriptions() {
  return [..._subscriptions.values()].map(sub => serializeSub(sub));
}

/**
 * Delete a subscription: disconnect all dpConnects, close SSE clients, remove from store.
 * @param {string} id
 * @param {object} monitor  monitor module (passed to avoid circular deps)
 * @returns {boolean} true if existed
 */
function deleteSubscription(id, monitor) {
  const sub = _subscriptions.get(id);
  if (!sub) return false;

  // Disconnect all monitored items
  for (const [, item] of sub.monitoredItems) {
    monitor.disconnect(item.connectId);
  }
  sub.monitoredItems.clear();

  // Close all SSE clients
  for (const res of sub.sseClients) {
    try { res.end(); } catch (_e) { /* ignore */ }
  }
  sub.sseClients.clear();

  _subscriptions.delete(id);
  return true;
}

/**
 * Push a value update to a subscription:
 * - Appends to valueQueue
 * - Writes to all active SSE clients
 *
 * @param {string} id  subscriptionId
 * @param {string} elementId
 * @param {{value, quality, timestamp}} vqt
 */
function pushUpdate(id, elementId, vqt) {
  const sub = _subscriptions.get(id);
  if (!sub) return;

  const item = { [elementId]: { data: [vqt] } };

  // Enqueue for sync, bounded to prevent unbounded memory growth when
  // /sync is never called (e.g. SSE-only subscriptions).
  sub.valueQueue.push(item);
  if (sub.valueQueue.length > MAX_QUEUE_SIZE) {
    sub.valueQueue.splice(0, sub.valueQueue.length - MAX_QUEUE_SIZE);
  }

  // Push to SSE streams
  const payload = `data: ${JSON.stringify([item])}\n\n`;
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
 * Drain and return the queued updates for a subscription.
 * @param {string} id
 * @returns {object[]}
 */
function drainQueue(id) {
  const sub = _subscriptions.get(id);
  if (!sub) return null;
  const items = sub.valueQueue.splice(0);
  return items;
}

/**
 * Add an SSE response object to a subscription's client set.
 * @param {string} id
 * @param {object} res  Express Response
 */
function addSseClient(id, res) {
  const sub = _subscriptions.get(id);
  if (!sub) return false;
  sub.sseClients.add(res);
  return true;
}

/**
 * Remove an SSE response from a subscription's client set.
 * @param {string} id
 * @param {object} res
 */
function removeSseClient(id, res) {
  const sub = _subscriptions.get(id);
  if (!sub) return;
  sub.sseClients.delete(res);
}

function serializeSub(sub) {
  return {
    subscriptionId: sub.id,
    created: sub.created.toISOString(),
    monitoredCount: sub.monitoredItems.size,
    sseClientCount: sub.sseClients.size,
  };
}

module.exports = {
  createSubscription,
  getSubscription,
  listSubscriptions,
  deleteSubscription,
  pushUpdate,
  drainQueue,
  addSseClient,
  removeSseClient,
  serializeSub,
};
