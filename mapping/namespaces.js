'use strict';

const { WinccoaManager } = require('winccoa-manager');

const winccoa = new WinccoaManager();

// Cached system-level namespace URI — computed once at startup.
// All DP types share a single namespace per WinCC OA system.
let _systemUri = null;

/**
 * Return the system-level namespace URI: http://winccoa.local/<systemName>
 * @returns {string}
 */
function getSystemUri() {
  if (!_systemUri) {
    const rawName = winccoa.getSystemName() || 'default';
    const systemName = rawName.endsWith(':') ? rawName.slice(0, -1) : rawName;
    _systemUri = `http://winccoa.local/${systemName}`;
  }
  return _systemUri;
}

/**
 * Build the list of i3X Namespace objects.
 * Returns a single namespace for the WinCC OA system (all types share it).
 *
 * @returns {Array<{uri: string, displayName: string}>}
 */
async function buildNamespaceList() {
  const uri = getSystemUri();
  // Extract system name from URI for displayName
  const systemName = uri.replace('http://winccoa.local/', '');
  return [{ uri, displayName: systemName }];
}

/**
 * Return the namespace URI for any DP type name.
 * All types belong to the single system-level namespace.
 * @param {string} _typeName  (unused — kept for API compatibility)
 * @returns {string}
 */
function typeNameToUri(_typeName) {
  return getSystemUri();
}

module.exports = { buildNamespaceList, typeNameToUri, getSystemUri };
