'use strict';

const express = require('express');
const { WinccoaManager } = require('winccoa-manager');
const { getDpeHistory, readObjectHistory } = require('../mapping/values');
const {
  elementIdToDpe,
  getObjectInstancesByIds,
  getObjectValueInfo,
  collectDpeLeaves,
  buildObjectInstanceList,
} = require('../mapping/hierarchy');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const winccoa = new WinccoaManager();
const router = express.Router();

/**
 * Expand a requested elementId into one or more history targets.
 * Each target is either a concrete DPE or a composition-marker entry that
 * emits an empty-history result.
 *
 *  - Scalar leaf                     → 1 DPE target
 *  - Struct DP / struct sub-path     → N targets (one per leaf DPE), each
 *                                      keyed by the leaf's full DPE-path
 *                                      elementId (synthetic: `${eid}/${relPath}`)
 *  - Composition folder              → per-child expansion at maxDepth > 1,
 *                                      else one composition marker
 *  - Unknown id                      → null
 */
async function expandHistoryTargets(eid, maxDepth) {
  const info = await getObjectValueInfo(eid);
  if (info) {
    const leaves = await collectDpeLeaves(info);
    if (leaves.length === 0) return null;
    if (leaves.length === 1 && leaves[0].relPath === '') {
      return [{ elementId: eid, dpe: leaves[0].dpe, isComposition: false }];
    }
    // Struct: emit one target per leaf, keyed by a synthetic id for the
    // bulk response so the caller can distinguish them.
    return leaves.map(l => ({
      elementId: `${eid}/${l.relPath.replace(/\./g, '/')}`,
      dpe: l.dpe,
      isComposition: false,
    }));
  }

  // Not a DP/DPE entity — must be a folder or unknown.
  const [rec] = await getObjectInstancesByIds([eid]);
  if (!rec) return null;

  if (maxDepth === 1) {
    return [{ elementId: eid, dpe: null, isComposition: true }];
  }

  const childDepth = maxDepth === 0 ? 0 : maxDepth - 1;
  const children = await buildObjectInstanceList({ parentId: eid });
  const out = [];
  for (const child of children) {
    const sub = await expandHistoryTargets(child.elementId, childDepth);
    if (sub) out.push(...sub);
  }
  return out;
}

// POST /objects/history
router.post('/history', async (req, res) => {
  const { elementIds, startTime, endTime, maxDepth = 1, maxValues } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  if (!startTime || !endTime) {
    return sendError(res, 400, 'Validation error', '"startTime" and "endTime" are required');
  }

  try {
    const items = [];
    for (const eid of elementIds) {
      const targets = await expandHistoryTargets(eid, maxDepth);
      if (targets === null) {
        items.push(bulkItem({
          elementId: eid,
          error: { code: 404, message: `Object '${eid}' not found` },
        }));
        continue;
      }
      for (const t of targets) {
        if (t.isComposition) {
          items.push(bulkItem({
            elementId: t.elementId,
            result: { isComposition: true, values: [] },
          }));
          continue;
        }
        try {
          const values = await getDpeHistory(t.dpe, startTime, endTime, maxValues);
          items.push(bulkItem({
            elementId: t.elementId,
            result: { isComposition: false, values },
          }));
        } catch (exc) {
          items.push(bulkItem({
            elementId: t.elementId,
            error: { code: 500, message: String(exc) },
          }));
        }
      }
    }
    sendBulk(res, items);
  } catch (exc) {
    console.error('POST /objects/history failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// GET /objects/{elementId}/history?startTime&endTime&maxValues
router.get('/:elementId/history', async (req, res) => {
  const elementId = decodeURIComponent(req.params.elementId);
  const { startTime, endTime, maxValues } = req.query;
  if (!startTime || !endTime) {
    return sendError(res, 400, 'Validation error', '"startTime" and "endTime" are required');
  }
  try {
    const result = await readObjectHistory(elementId, startTime, endTime, maxValues ? Number(maxValues) : undefined);
    if (!result) {
      return sendError(res, 404, 'Object not found', `No leaf-DPE history for '${elementId}'`);
    }
    sendSuccess(res, { isComposition: false, ...result });
  } catch (exc) {
    console.error(`GET /objects/${elementId}/history failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// PUT /objects/{elementId}/history   Body: { data: [{value, timestamp}] }
router.put('/:elementId/history', async (req, res) => {
  const elementId = decodeURIComponent(req.params.elementId);
  const { data } = req.body || {};
  if (!Array.isArray(data) || data.length === 0) {
    return sendError(res, 400, 'Validation error', '"data" array is required');
  }
  try {
    const dpe = await elementIdToDpe(elementId);
    if (!dpe) {
      return sendError(res, 404, 'Object not found', `No writable leaf DPE for elementId '${elementId}'`);
    }
    for (const entry of data) {
      const ts = new Date(entry.timestamp);
      await winccoa.dpSetTimedWait(ts, dpe, entry.value);
    }
    sendSuccess(res, null);
  } catch (exc) {
    console.error(`PUT /objects/${elementId}/history failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
