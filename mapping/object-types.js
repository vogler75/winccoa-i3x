'use strict';

const { WinccoaManager } = require('winccoa-manager');
const { typeNameToUri } = require('./namespaces');
const { dpTypeNodeToSchema } = require('../utils/json-schema');

const winccoa = new WinccoaManager();

const FOLDER_TYPE = {
  elementId: 'FolderType',
  displayName: 'FolderType',
  namespaceUri: 'http://winccoa.local/FolderType',
  sourceTypeId: 'FolderType',
  schema: { type: 'object', properties: {} },
};

/**
 * Build the list of i3X ObjectType objects from WinCC OA DP types.
 * Shape per i3X v1 spec:
 *   { elementId, displayName, namespaceUri, sourceTypeId, schema, version?, related? }
 *
 * @param {{ namespaceUri?: string }} [filter]
 * @returns {Array<object>}
 */
async function buildObjectTypeList(filter) {
  const typeNames = winccoa.dpTypes('*');
  const result = [];

  for (const typeName of typeNames) {
    if (typeName.startsWith('_')) continue;

    const nsUri = typeNameToUri(typeName);

    if (filter && filter.namespaceUri && nsUri !== filter.namespaceUri) {
      continue;
    }

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
      schema: dpTypeNodeToSchema(typeNode),
    });
  }

  if (!filter || !filter.namespaceUri || filter.namespaceUri === FOLDER_TYPE.namespaceUri) {
    result.unshift(FOLDER_TYPE);
  }

  return result;
}

/**
 * Get specific ObjectTypes by elementId array.
 * Returns one entry per requested id; null entries for unknown ids so the
 * caller can build a per-item bulk response.
 * @param {string[]} elementIds
 * @returns {Array<object|null>} same length as elementIds
 */
async function getObjectTypesByIds(elementIds) {
  return elementIds.map(typeName => {
    if (typeName === 'FolderType') return FOLDER_TYPE;
    if (typeName.startsWith('_')) return null;

    const typeNode = winccoa.dpTypeGet(typeName, true);
    if (!typeNode) return null;

    return {
      elementId: typeName,
      displayName: typeName,
      namespaceUri: typeNameToUri(typeName),
      sourceTypeId: typeName,
      schema: dpTypeNodeToSchema(typeNode),
    };
  });
}

module.exports = { buildObjectTypeList, getObjectTypesByIds };
