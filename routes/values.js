'use strict';

const express = require('express');
const { getValuesByElementIds, setDpeValue } = require('../mapping/values');
const { elementIdToDpe, resolveLeafIds } = require('../mapping/hierarchy');
const { sendError } = require('../utils/errors');

const router = express.Router();

// POST /objects/value
// Body: { elementIds: string[], maxDepth?: number }
router.post('/value', async (req, res) => {
  const { elementIds, maxDepth = 1 } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }

  try {
    const resolvedIds = await resolveLeafIds(elementIds, maxDepth);

    const valuesMap = await getValuesByElementIds(resolvedIds);

    // Shape per spec: { [elementId]: { data: [VQT] } }
    const data = {};
    for (const [eid, vqt] of Object.entries(valuesMap)) {
      if (vqt !== null) {
        data[eid] = { data: [vqt] };
      }
    }

    res.json(data);
  } catch (exc) {
    console.error('POST /objects/value failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// PUT /objects/:elementId/value
// Body: { value: any }
router.put('/:elementId/value', async (req, res) => {
  const elementId = decodeURIComponent(req.params.elementId);
  const { value } = req.body || {};
  if (value === undefined) {
    return sendError(res, 400, 'Validation error', '"value" is required in request body');
  }

  try {
    const dpe = await elementIdToDpe(elementId);
    if (!dpe) {
      return sendError(res, 404, 'Object not found', `No writable DPE for elementId '${elementId}'`);
    }
    await setDpeValue(dpe, value);
    res.status(204).end();
  } catch (exc) {
    console.error(`PUT /objects/${elementId}/value failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
