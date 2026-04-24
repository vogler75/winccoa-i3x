'use strict';

const express = require('express');
const { getRelationshipTypes, getRelationshipTypesByIds } = require('../mapping/relationships');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const router = express.Router();

// GET /relationshiptypes[?namespaceUri=...]
router.get('/', (req, res) => {
  try {
    const filter = req.query.namespaceUri ? { namespaceUri: req.query.namespaceUri } : undefined;
    sendSuccess(res, getRelationshipTypes(filter));
  } catch (exc) {
    console.error('GET /relationshiptypes failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /relationshiptypes/query   Body: { elementIds: string[] }
router.post('/query', (req, res) => {
  const { elementIds } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  try {
    const matches = getRelationshipTypesByIds(elementIds);
    const byId = new Map(matches.map(r => [r.elementId, r]));
    const items = elementIds.map(eid => {
      const result = byId.get(eid);
      if (result) return bulkItem({ elementId: eid, result });
      return bulkItem({
        elementId: eid,
        error: { code: 404, message: `RelationshipType '${eid}' not found` },
      });
    });
    sendBulk(res, items);
  } catch (exc) {
    console.error('POST /relationshiptypes/query failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
