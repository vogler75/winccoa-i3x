'use strict';

const express = require('express');
const { getRelationshipTypes, getRelationshipTypesByIds } = require('../mapping/relationships');
const { sendError } = require('../utils/errors');

const router = express.Router();

// GET /relationshiptypes[?namespaceUri=...]
router.get('/', (req, res) => {
  try {
    const filter = req.query.namespaceUri ? { namespaceUri: req.query.namespaceUri } : undefined;
    const relationshipTypes = getRelationshipTypes(filter);
    res.json(relationshipTypes);
  } catch (exc) {
    console.error('GET /relationshiptypes failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /relationshiptypes/query
// Body: { elementIds: string[] }
router.post('/query', (req, res) => {
  const { elementIds } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  try {
    const relationshipTypes = getRelationshipTypesByIds(elementIds);
    res.json(relationshipTypes);
  } catch (exc) {
    console.error('POST /relationshiptypes/query failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
