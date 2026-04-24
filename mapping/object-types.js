'use strict';

const { WinccoaManager } = require('winccoa-manager');
const { typeNameToUri } = require('./namespaces');
const { dpTypeNodeToSchema, elemTypeToSchema, ET } = require('../utils/json-schema');

const winccoa = new WinccoaManager();

/**
 * Fetches a referenced DpType tree for `Typeref` expansion in JSON Schema.
 * Returns null when the referenced type does not exist.
 */
function resolveTyperef(refName) {
  try { return winccoa.dpTypeGet(refName, true); } catch (_e) { return null; }
}

const BASE_TYPE_NS = 'http://i3x.dev/base';

/**
 * Synthetic, built-in ObjectTypes. These back the `typeElementId` references
 * we place on nested ObjectInstances:
 *   - `FolderType`  — CNS folder nodes
 *   - `object`      — inline struct sub-nodes (no named WinCC OA type)
 *   - primitives    — leaf DPE element types (Float, Bool, …) from WinccoaElementType
 */
function buildSyntheticTypes() {
  const types = [
    {
      elementId: 'FolderType',
      displayName: 'FolderType',
      namespaceUri: BASE_TYPE_NS,
      sourceTypeId: 'FolderType',
      schema: { type: 'object', properties: {} },
    },
    {
      elementId: 'object',
      displayName: 'object',
      namespaceUri: BASE_TYPE_NS,
      sourceTypeId: 'object',
      schema: { type: 'object', additionalProperties: true },
    },
  ];
  for (const [name, et] of Object.entries(ET)) {
    if (name === 'Struct') continue;
    types.push({
      elementId: name,
      displayName: name,
      namespaceUri: BASE_TYPE_NS,
      sourceTypeId: name,
      schema: elemTypeToSchema(et),
    });
  }
  return types;
}

const SYNTHETIC_TYPES = buildSyntheticTypes();
const SYNTHETIC_BY_ID = new Map(SYNTHETIC_TYPES.map(t => [t.elementId, t]));

async function buildObjectTypeList(filter) {
  const result = [];

  // Synthetic types first, filtered by namespace if requested.
  for (const t of SYNTHETIC_TYPES) {
    if (!filter || !filter.namespaceUri || filter.namespaceUri === t.namespaceUri) {
      result.push(t);
    }
  }

  // WinCC OA DP types.
  const typeNames = winccoa.dpTypes('*');
  for (const typeName of typeNames) {
    if (typeName.startsWith('_')) continue;

    const nsUri = typeNameToUri(typeName);
    if (filter && filter.namespaceUri && nsUri !== filter.namespaceUri) continue;

    const typeNode = winccoa.dpTypeGet(typeName, true);
    if (!typeNode) {
      console.warn('dpTypeGet returned null for type:', typeName);
      continue;
    }
    result.push({
      elementId: typeName,
      displayName: typeName,
      namespaceUri: nsUri,
      sourceTypeId: typeName,
      schema: dpTypeNodeToSchema(typeNode, resolveTyperef),
    });
  }

  return result;
}

async function getObjectTypesByIds(elementIds) {
  return elementIds.map(typeName => {
    if (SYNTHETIC_BY_ID.has(typeName)) return SYNTHETIC_BY_ID.get(typeName);
    if (typeName.startsWith('_')) return null;

    const typeNode = winccoa.dpTypeGet(typeName, true);
    if (!typeNode) return null;

    return {
      elementId: typeName,
      displayName: typeName,
      namespaceUri: typeNameToUri(typeName),
      sourceTypeId: typeName,
      schema: dpTypeNodeToSchema(typeNode, resolveTyperef),
    };
  });
}

module.exports = { buildObjectTypeList, getObjectTypesByIds };
