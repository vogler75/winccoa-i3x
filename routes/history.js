'use strict';

const express = require('express');
const { WinccoaManager } = require('winccoa-manager');
const { getDpeHistory } = require('../mapping/values');
const {
  elementIdToDpe,
  getObjectInstancesByIds,
  collectLeafDescendants,
} = require('../mapping/hierarchy');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const winccoa = new WinccoaManager();
const router = express.Router();

/**
 * Resolve a single input elementId into the set of leaf DPEs whose history
 * the caller wants. Returns `[{ elementId, dpe, isComposition }]`.
 *
 *  - Leaf input → one entry with isComposition:false.
 *  - Composition input + maxDepth>1 → one entry per leaf descendant.
 *  - Composition input + maxDepth=1 → one entry marking the composition itself
 *    (result will carry isComposition:true with empty values[]).
 */
async function expandHistoryTargets(eid, maxDepth) {
  const dpe = await elementIdToDpe(eid);
  if (dpe) return [{ elementId: eid, dpe, isComposition: false }];

  const [rec] = await getObjectInstancesByIds([eid]);
  if (!rec) return null;

  if (maxDepth === 1) {
    return [{ elementId: eid, dpe: null, isComposition: true }];
  }
  const leaves = await collectLeafDescendants(eid, maxDepth);
  return leaves.map(l => ({ elementId: l.elementId, dpe: l.dpe, isComposition: false }));
}

// POST /objects/history
// Body: { elementIds, startTime, endTime, maxDepth?, maxValues? }
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

// GET /objects/{elementId}/history?startTime&endTime&maxDepth&maxValues
router.get('/:elementId/history', async (req, res) => {
  const elementId = decodeURIComponent(req.params.elementId);
  const { startTime, endTime, maxValues } = req.query;
  if (!startTime || !endTime) {
    return sendError(res, 400, 'Validation error', '"startTime" and "endTime" are required');
  }
  try {
    const dpe = await elementIdToDpe(elementId);
    if (!dpe) {
      return sendError(res, 404, 'Object not found', `No readable DPE for elementId '${elementId}'`);
    }
    const values = await getDpeHistory(dpe, startTime, endTime, maxValues ? Number(maxValues) : undefined);
    sendSuccess(res, { isComposition: false, values });
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
      return sendError(res, 404, 'Object not found', `No writable DPE for elementId '${elementId}'`);
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
