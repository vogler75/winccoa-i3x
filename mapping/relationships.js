'use strict';

/**
 * Built-in i3X relationship type definitions.
 * These are always present — no WinCC OA lookup needed.
 */

const BASE_NS = 'http://i3x.dev/base';

const RELATIONSHIP_TYPES = [
  {
    elementId: 'HasParent',
    displayName: 'HasParent',
    namespaceUri: BASE_NS,
    reverseOf: 'HasChildren',
  },
  {
    elementId: 'HasChildren',
    displayName: 'HasChildren',
    namespaceUri: BASE_NS,
    reverseOf: 'HasParent',
  },
  {
    elementId: 'HasComponent',
    displayName: 'HasComponent',
    namespaceUri: BASE_NS,
    reverseOf: 'ComponentOf',
  },
  {
    elementId: 'ComponentOf',
    displayName: 'ComponentOf',
    namespaceUri: BASE_NS,
    reverseOf: 'HasComponent',
  },
];

/**
 * Return all relationship types, optionally filtered by namespaceUri.
 * @param {{ namespaceUri?: string }} [filter]
 * @returns {Array<object>}
 */
function getRelationshipTypes(filter) {
  if (filter && filter.namespaceUri) {
    return RELATIONSHIP_TYPES.filter(r => r.namespaceUri === filter.namespaceUri);
  }
  return RELATIONSHIP_TYPES.slice();
}

/**
 * Return specific relationship types by elementId array.
 * @param {string[]} elementIds
 * @returns {Array<object>}
 */
function getRelationshipTypesByIds(elementIds) {
  const idSet = new Set(elementIds);
  return RELATIONSHIP_TYPES.filter(r => idSet.has(r.elementId));
}

module.exports = { getRelationshipTypes, getRelationshipTypesByIds, RELATIONSHIP_TYPES };
