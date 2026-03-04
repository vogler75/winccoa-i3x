'use strict';

const express = require('express');
const { buildObjectTypeList, getObjectTypesByIds } = require('../mapping/object-types');
const { sendError } = require('../utils/errors');

const router = express.Router();

// GET /objecttypes[?namespaceUri=...]
router.get('/', async (req, res) => {
  try {
    const filter = req.query.namespaceUri ? { namespaceUri: req.query.namespaceUri } : undefined;
    const objectTypes = await buildObjectTypeList(filter);
    res.json(objectTypes);
  } catch (exc) {
    console.error('GET /objecttypes failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /objecttypes/query
// Body: { elementIds: string[] }
router.post('/query', async (req, res) => {
  const { elementIds } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  try {
    const objectTypes = await getObjectTypesByIds(elementIds);
    res.json(objectTypes);
  } catch (exc) {
    console.error('POST /objecttypes/query failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
