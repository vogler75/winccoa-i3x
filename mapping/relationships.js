'use strict';

/**
 * Built-in i3X relationship type definitions.
 * These are always present — no WinCC OA lookup needed.
 *
 * Shape per i3X v1 spec:
 *   { elementId, displayName, namespaceUri, relationshipId, reverseOf }
 */

const BASE_NS = 'http://i3x.dev/base';

const RELATIONSHIP_TYPES = [
  {
    elementId: 'HasParent',
    displayName: 'HasParent',
    namespaceUri: BASE_NS,
    relationshipId: 'HasParent',
    reverseOf: 'HasChildren',
  },
  {
    elementId: 'HasChildren',
    displayName: 'HasChildren',
    namespaceUri: BASE_NS,
    relationshipId: 'HasChildren',
    reverseOf: 'HasParent',
  },
  {
    elementId: 'HasComponent',
    displayName: 'HasComponent',
    namespaceUri: BASE_NS,
    relationshipId: 'HasComponent',
    reverseOf: 'ComponentOf',
  },
  {
    elementId: 'ComponentOf',
    displayName: 'ComponentOf',
    namespaceUri: BASE_NS,
    relationshipId: 'ComponentOf',
    reverseOf: 'HasComponent',
  },
];

function getRelationshipTypes(filter) {
  if (filter && filter.namespaceUri) {
    return RELATIONSHIP_TYPES.filter(r => r.namespaceUri === filter.namespaceUri);
  }
  return RELATIONSHIP_TYPES.slice();
}

function getRelationshipTypesByIds(elementIds) {
  const idSet = new Set(elementIds);
  return RELATIONSHIP_TYPES.filter(r => idSet.has(r.elementId));
}

module.exports = { getRelationshipTypes, getRelationshipTypesByIds, RELATIONSHIP_TYPES };
