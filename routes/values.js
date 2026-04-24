'use strict';

const express = require('express');
const { getDpeValues, setDpeValue } = require('../mapping/values');
const {
  elementIdToDpe,
  getObjectInstancesByIds,
  collectLeafDescendants,
} = require('../mapping/hierarchy');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const router = express.Router();

/**
 * Build a v1 CurrentValueResult for a single elementId.
 *  - Leaf DPE        → { isComposition: false, value, quality, timestamp }
 *  - Composition     → { isComposition: true,  value: null, quality: 'GoodNoData',
 *                        timestamp: now, components?: { relPath: VQT } }
 *  - Unknown id      → throws (caller converts to an error bulk item)
 *
 * `components` is present only when maxDepth > 1 (or 0=infinite), per spec.
 */
async function readCurrentValue(eid, maxDepth) {
  const dpe = await elementIdToDpe(eid);
  if (dpe) {
    const [vqt] = await getDpeValues([dpe]);
    return { isComposition: false, ...vqt };
  }
  const [rec] = await getObjectInstancesByIds([eid]);
  if (!rec) {
    const err = new Error(`Object '${eid}' not found`);
    err.code = 404;
    throw err;
  }
  const result = {
    isComposition: true,
    value: null,
    quality: 'GoodNoData',
    timestamp: new Date().toISOString(),
  };
  if (maxDepth !== 1) {
    const leaves = await collectLeafDescendants(eid, maxDepth);
    const components = {};
    if (leaves.length > 0) {
      const vqts = await getDpeValues(leaves.map(l => l.dpe));
      for (let i = 0; i < leaves.length; i++) {
        components[leaves[i].relPath] = vqts[i];
      }
    }
    result.components = components;
  }
  return result;
}

// POST /objects/value   Body: { elementIds, maxDepth? }
router.post('/value', async (req, res) => {
  const { elementIds, maxDepth = 1 } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  try {
    const items = [];
    for (const eid of elementIds) {
      try {
        const result = await readCurrentValue(eid, maxDepth);
        items.push(bulkItem({ elementId: eid, result }));
      } catch (exc) {
        const code = exc.code || 500;
        items.push(bulkItem({
          elementId: eid,
          error: { code, message: exc.message || String(exc) },
        }));
      }
    }
    sendBulk(res, items);
  } catch (exc) {
    console.error('POST /objects/value failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// PUT /objects/{elementId}/value   Body: raw value (any JSON)
router.put('/:elementId/value', async (req, res) => {
  const elementId = decodeURIComponent(req.params.elementId);
  const value = req.body;
  if (value === undefined) {
    return sendError(res, 400, 'Validation error', 'request body is required');
  }
  try {
    const dpe = await elementIdToDpe(elementId);
    if (!dpe) {
      return sendError(res, 404, 'Object not found', `No writable DPE for elementId '${elementId}'`);
    }
    await setDpeValue(dpe, value);
    sendSuccess(res, null);
  } catch (exc) {
    console.error(`PUT /objects/${elementId}/value failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
