'use strict';

const { WinccoaManager } = require('winccoa-manager');
const { typeNameToUri } = require('./namespaces');
const { dpTypeNodeToSchema } = require('../utils/json-schema');

const winccoa = new WinccoaManager();

const FOLDER_TYPE = {
  elementId: 'FolderType',
  displayName: 'FolderType',
  namespaceUri: 'http://winccoa.local/FolderType',
  schema: { type: 'object', properties: {} },
};

/**
 * Build the list of i3X ObjectType objects from WinCC OA DP types.
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
      elementId: typeName,          // plain name per spec e.g. "PumpType"
      displayName: typeName,
      namespaceUri: nsUri,
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
 * @param {string[]} elementIds  plain type names e.g. ["PumpType"]
 * @returns {Array<object>}
 */
async function getObjectTypesByIds(elementIds) {
  const result = [];
  for (const typeName of elementIds) {
    if (typeName === 'FolderType') {
      result.push(FOLDER_TYPE);
      continue;
    }
    if (typeName.startsWith('_')) continue;

    const typeNode = winccoa.dpTypeGet(typeName, true);
    if (!typeNode) continue;

    result.push({
      elementId: typeName,
      displayName: typeName,
      namespaceUri: typeNameToUri(typeName),
      schema: dpTypeNodeToSchema(typeNode),
    });
  }
  return result;
}

module.exports = { buildObjectTypeList, getObjectTypesByIds };
