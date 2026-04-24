'use strict';

const express = require('express');
const {
  buildObjectInstanceList,
  getObjectInstancesByIds,
  getRelatedObjects,
  getRelationships,
} = require('../mapping/hierarchy');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const router = express.Router();

/**
 * Serialize a cached ObjectInstance record into the v1 ObjectInstanceResponse
 * shape. Internal fields move behind `metadata` and are only populated when
 * the caller requested `includeMetadata`.
 */
async function serializeInstance(rec, includeMetadata) {
  const out = {
    elementId: rec.elementId,
    displayName: rec.displayName,
    typeElementId: rec.typeElementId,
    isComposition: !!rec.isComposition,
    isExtended: false,
  };
  if (rec.parentId !== undefined) out.parentId = rec.parentId;
  if (includeMetadata) {
    out.metadata = {
      typeNamespaceUri: rec.namespaceUri || null,
      sourceTypeId: rec.typeElementId,
      description: null,
      relationships: await getRelationships(rec.elementId),
      extendedAttributes: null,
      system: null,
    };
  }
  return out;
}

async function serializeMany(recs, includeMetadata) {
  return Promise.all(recs.map(r => serializeInstance(r, includeMetadata)));
}

function parseBool(v) {
  if (v === undefined) return false;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
}

// GET /objects[?typeElementId=...][&includeMetadata=...][&root=true]
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.typeElementId) filter.typeElementId = req.query.typeElementId;
    if (req.query.parentId) filter.parentId = req.query.parentId;
    if (req.query.root !== undefined) filter.root = parseBool(req.query.root);

    const includeMetadata = parseBool(req.query.includeMetadata);
    const objects = await buildObjectInstanceList(Object.keys(filter).length ? filter : undefined);
    sendSuccess(res, await serializeMany(objects, includeMetadata));
  } catch (exc) {
    console.error('GET /objects failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /objects/list   Body: { elementIds: string[], includeMetadata?: boolean }
router.post('/list', async (req, res) => {
  const { elementIds, includeMetadata = false } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  try {
    const matches = await getObjectInstancesByIds(elementIds);
    const byId = new Map(matches.map(r => [r.elementId, r]));
    const items = [];
    for (const eid of elementIds) {
      const rec = byId.get(eid);
      if (rec) {
        items.push(bulkItem({ elementId: eid, result: await serializeInstance(rec, includeMetadata) }));
      } else {
        items.push(bulkItem({
          elementId: eid,
          error: { code: 404, message: `Object '${eid}' not found` },
        }));
      }
    }
    sendBulk(res, items);
  } catch (exc) {
    console.error('POST /objects/list failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

// POST /objects/related
// Body: { elementIds: string[], relationshipType?: string, includeMetadata?: boolean }
router.post('/related', async (req, res) => {
  const { elementIds, relationshipType, includeMetadata = false } = req.body || {};
  if (!Array.isArray(elementIds)) {
    return sendError(res, 400, 'Validation error', '"elementIds" array is required');
  }
  if (relationshipType !== undefined && (typeof relationshipType !== 'string' || !relationshipType)) {
    return sendError(res, 400, 'Validation error', '"relationshipType" must be a non-empty string');
  }
  try {
    // getRelatedObjects currently returns a flat list of matching objects
    // without telling us which input produced each match. Issue one query per
    // input id so we can build the per-item bulk response and set
    // sourceRelationship correctly on each RelatedObjectResult.
    const items = [];
    for (const eid of elementIds) {
      const matches = await getRelatedObjects([eid], relationshipType);
      const related = await Promise.all(matches.map(async rec => ({
        sourceRelationship: resolveSourceRelationship(eid, rec, relationshipType),
        object: await serializeInstance(rec, includeMetadata),
      })));
      items.push(bulkItem({ elementId: eid, result: related }));
    }
    sendBulk(res, items);
  } catch (exc) {
    console.error('POST /objects/related failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

/**
 * Best-effort label for the relationship a given related record was found
 * through. If the caller specified `relationshipType`, that wins. Otherwise
 * we infer parent-vs-child from the hierarchy records themselves.
 */
function resolveSourceRelationship(sourceId, rec, relationshipType) {
  if (relationshipType) return relationshipType;
  if (rec.parentId === sourceId) return 'HasChildren';
  return 'HasParent';
}

module.exports = router;
