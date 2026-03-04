'use strict';

/**
 * elementId encoding / decoding helpers.
 *
 * Conventions (from AGENTS.md):
 *   ObjectType       → "type:{DpTypeName}"        e.g. "type:MotorType"
 *   ObjectInstance   → "obj:{cnsPath}"             e.g. "obj:Plant1/Area1/Motor1"
 *   ObjInstance DPE  → "obj:{cnsPath}/{element}"   e.g. "obj:Plant1/Area1/Motor1/speed"
 *   RelationshipType → "rel:{name}"                e.g. "rel:HasParent"
 *   Namespace URI    → bare URI string             e.g. "http://winccoa.local/MotorType"
 */

function typeId(dpTypeName) {
  return `type:${dpTypeName}`;
}

function objId(cnsPath) {
  return `obj:${cnsPath}`;
}

function relId(name) {
  return `rel:${name}`;
}

/**
 * Decode an elementId into { kind, value }.
 * kind is one of: 'type', 'obj', 'rel', 'unknown'
 */
function decode(elementId) {
  if (typeof elementId !== 'string') return { kind: 'unknown', value: elementId };
  const colonIdx = elementId.indexOf(':');
  if (colonIdx === -1) return { kind: 'unknown', value: elementId };
  const prefix = elementId.slice(0, colonIdx);
  const value = elementId.slice(colonIdx + 1);
  if (prefix === 'type' || prefix === 'obj' || prefix === 'rel') {
    return { kind: prefix, value };
  }
  return { kind: 'unknown', value: elementId };
}

/**
 * Given an obj: elementId, return the WinCC OA DPE address.
 * Converts "obj:Plant1/Area1/Motor1/speed" → "Motor1.speed"
 * and "obj:Plant1/Area1/Motor1" → "Motor1" (DP root, needs trailing dot for dpGet)
 *
 * cnsPathToDpName is the mapping built by hierarchy.js (cnsPath → dpName).
 * dpStructMap maps cnsPath → { dpName, elemPath } for DPE nodes.
 */
function objIdToDpe(elementId, cnsPathToDpName) {
  const { kind, value } = decode(elementId);
  if (kind !== 'obj') return null;

  // Direct lookup — hierarchy module should have pre-computed this
  if (cnsPathToDpName && cnsPathToDpName[value] !== undefined) {
    return cnsPathToDpName[value];
  }
  return null;
}

module.exports = { typeId, objId, relId, decode, objIdToDpe };
