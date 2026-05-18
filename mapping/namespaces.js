'use strict';

const { WinccoaManager } = require('winccoa-manager');

const winccoa = new WinccoaManager();
const BASE_NAMESPACE_URI = 'http://i3x.dev/base';

// Cached system-level namespace URI — computed once at startup.
// WinCC OA DP types share this namespace; synthetic i3X built-ins use BASE_NAMESPACE_URI.
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
 * Returns the WinCC OA system namespace plus the base namespace for built-ins.
 *
 * @returns {Array<{uri: string, displayName: string}>}
 */
async function buildNamespaceList() {
  const uri = getSystemUri();
  // Extract system name from URI for displayName
  const systemName = uri.replace('http://winccoa.local/', '');
  return [
    { uri, displayName: systemName },
    { uri: BASE_NAMESPACE_URI, displayName: 'i3X Base' },
  ];
}

/**
 * Return the namespace URI for any WinCC OA DP type name.
 * Synthetic built-in types use BASE_NAMESPACE_URI in their own mapper.
 * @param {string} _typeName  (unused — kept for API compatibility)
 * @returns {string}
 */
function typeNameToUri(_typeName) {
  return getSystemUri();
}

module.exports = { buildNamespaceList, typeNameToUri, getSystemUri, BASE_NAMESPACE_URI };
