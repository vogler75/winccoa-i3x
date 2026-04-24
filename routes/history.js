'use strict';

const express = require('express');
const { getDpeHistory } = require('../mapping/values');
const { elementIdToDpe, resolveLeafIds } = require('../mapping/hierarchy');
const { sendError } = require('../utils/errors');

const router = express.Router();

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
    const resolvedIds = await resolveLeafIds(elementIds, maxDepth);

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
      await winccoa.dpSetTimedWait(ts, dpe, entry.value);
    }

    res.status(204).end();
  } catch (exc) {
    console.error(`PUT /objects/${elementId}/history failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
