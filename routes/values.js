'use strict';

const express = require('express');
const { getValuesByElementIds, setDpeValue } = require('../mapping/values');
const { buildObjectInstanceList } = require('../mapping/hierarchy');
const { elementIdToDpe } = require('../mapping/hierarchy');
const { sendError } = require('../utils/errors');

const router = express.Router();

/**
 * Recursively collect all leaf elementIds up to maxDepth levels.
 * Returns a flat list of elementIds (leaf DPEs only).
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

// POST /objects/value
// Body: { elementIds: string[], maxDepth?: number }
router.post('/value', async (req, res) => {
  const { elementIds, maxDepth = 1 } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }

  try {
    const resolvedIds = maxDepth > 1
      ? await collectLeafIds(elementIds, maxDepth)
      : elementIds;

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
