'use strict';

const express = require('express');
const { getDpeHistory } = require('../mapping/values');
const { elementIdToDpe, buildObjectInstanceList } = require('../mapping/hierarchy');
const { sendError } = require('../utils/errors');

const router = express.Router();

/**
 * Collect all leaf elementIds up to maxDepth levels (same helper as values.js).
 */
async function collectLeafIds(elementIds, maxDepth) {
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

// POST /objects/history
// Body: { elementIds: string[], startTime: ISO string, endTime: ISO string, maxDepth?: number, maxValues?: number }
router.post('/history', async (req, res) => {
  const { elementIds, startTime, endTime, maxDepth = 1, maxValues } = req.body || {};

  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  if (!startTime || !endTime) {
    return sendError(res, 400, 'Validation error', '"startTime" and "endTime" are required');
  }

  try {
    const resolvedIds = maxDepth > 1
      ? await collectLeafIds(elementIds, maxDepth)
      : elementIds;

    const data = {};
    for (const eid of resolvedIds) {
      const dpe = await elementIdToDpe(eid);
      if (!dpe) continue;

      const rows = await getDpeHistory(dpe, startTime, endTime, maxValues);
      if (rows.length > 0) {
        data[eid] = { data: rows };
      }
    }

    res.json(data);
  } catch (exc) {
    console.error('POST /objects/history failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// PUT /objects/:elementId/history
// Body: { data: Array<{value, timestamp}> }
// Writes historical values for a single DPE.
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

    const { WinccoaManager } = require('winccoa-manager');
    const winccoa = new WinccoaManager();

    for (const entry of data) {
      const ts = new Date(entry.timestamp);
      await winccoa.dpSetTimedWait(dpe, entry.value, ts);
    }

    res.status(204).end();
  } catch (exc) {
    console.error(`PUT /objects/${elementId}/history failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
