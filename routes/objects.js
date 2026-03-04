'use strict';

const express = require('express');
const {
  buildObjectInstanceList,
  getObjectInstancesByIds,
  getRelatedObjects,
} = require('../mapping/hierarchy');
const { sendError } = require('../utils/errors');

const router = express.Router();

// GET /objects[?typeId=...][&includeMetadata=...]
// Lists all object instances.
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.typeId) filter.typeId = req.query.typeId;
    if (req.query.parentId) filter.parentId = req.query.parentId;

    const objects = await buildObjectInstanceList(Object.keys(filter).length ? filter : undefined);
    res.json(objects);
  } catch (exc) {
    console.error('GET /objects failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /objects/list
// Body: { elementIds: string[] }
router.post('/list', async (req, res) => {
  const { elementIds } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  try {
    const objects = await getObjectInstancesByIds(elementIds);
    res.json(objects);
  } catch (exc) {
    console.error('POST /objects/list failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /objects/related
// Body: { elementIds: string[], relationshipType?: string }
// When relationshipType is omitted, returns all related objects (parent + children).
router.post('/related', async (req, res) => {
  const { elementIds, relationshipType } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  if (relationshipType !== undefined && (typeof relationshipType !== 'string' || !relationshipType)) {
    return sendError(res, 400, 'Validation error', '"relationshipType" must be a non-empty string');
  }
  try {
    const objects = await getRelatedObjects(elementIds, relationshipType);
    res.json(objects);
  } catch (exc) {
    console.error('POST /objects/related failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
