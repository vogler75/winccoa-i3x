'use strict';

const express = require('express');
const { getDpeValues, setDpeValue } = require('../mapping/values');
const {
  buildObjectInstanceList,
  getObjectInstancesByIds,
  getObjectValueInfo,
  collectDpeLeaves,
  getTypeNode,
  elementIdToDpe,
} = require('../mapping/hierarchy');
const { ET } = require('../utils/json-schema');
const { sendSuccess, sendBulk, bulkItem } = require('../utils/response');
const { sendError } = require('../utils/errors');

const router = express.Router();

/**
 * Read VQT for a single primitive-leaf ObjectInstance. Returns null for
 * unknown or non-leaf elementIds.
 */
async function readLeafVqt(elementId) {
  const info = await getObjectValueInfo(elementId);
  if (!info) return null;
  const typeNode = await getTypeNode(info.typeName);
  if (!typeNode) return null;
  const node = info.subPath
    ? findNode(typeNode, info.subPath.split('.'))
    : typeNode;
  if (!node || node.type === ET.Struct) return null;
  const dpe = info.subPath ? `${info.dpName}.${info.subPath}` : `${info.dpName}.`;
  const [vqt] = await getDpeValues([dpe]);
  return vqt;
}

function findNode(node, segments) {
  if (!segments.length) return node;
  const [head, ...tail] = segments;
  const child = (node.children || []).find(c => c.name === head);
  return tail.length ? findNode(child, tail) : child;
}

/**
 * Build a v1 CurrentValueResult for a single elementId.
 *   - Primitive leaf          → scalar VQT
 *   - Struct sub-node / root  → value=null, components when maxDepth > 1
 *   - Folder                  → value=null, components with child object VQTs
 *                               when maxDepth > 1
 */
async function buildCurrentValue(elementId, maxDepth) {
  const [rec] = await getObjectInstancesByIds([elementId]);
  if (!rec) {
    const err = new Error(`Object '${elementId}' not found`);
    err.code = 404;
    throw err;
  }

  if (!rec.isComposition) {
    const vqt = await readLeafVqt(elementId);
    if (!vqt) {
      return { isComposition: false, value: null, quality: 'Bad', timestamp: new Date().toISOString() };
    }
    return { isComposition: false, ...vqt };
  }

  const result = {
    isComposition: true,
    value: null,
    quality: 'GoodNoData',
    timestamp: new Date().toISOString(),
  };

  if (maxDepth !== 1) {
    const childDepth = maxDepth === 0 ? 0 : maxDepth - 1;
    const children = await buildObjectInstanceList({ parentId: elementId });
    const components = {};
    for (const child of children) {
      try {
        components[child.elementId] = await buildCurrentValue(child.elementId, childDepth);
      } catch (exc) {
        components[child.elementId] = {
          value: null,
          quality: 'Bad',
          timestamp: new Date().toISOString(),
        };
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
        const result = await buildCurrentValue(eid, maxDepth);
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

// PUT /objects/{elementId}/value   Body: raw JSON value
router.put('/:elementId/value', async (req, res) => {
  const elementId = decodeURIComponent(req.params.elementId);
  const value = req.body;
  if (value === undefined) {
    return sendError(res, 400, 'Validation error', 'request body is required');
  }
  try {
    const dpe = await elementIdToDpe(elementId);
    if (!dpe) {
      return sendError(res, 404, 'Object not found', `No writable leaf DPE for elementId '${elementId}' — struct nodes are not writable as a whole`);
    }
    await setDpeValue(dpe, value);
    sendSuccess(res, null);
  } catch (exc) {
    console.error(`PUT /objects/${elementId}/value failed:`, exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
