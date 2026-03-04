'use strict';

const { WinccoaManager, WinccoaDpSub } = require('winccoa-manager');
const config = require('../config');
const { typeNameToUri, getSystemUri } = require('./namespaces');
const { ET, elemTypeName } = require('../utils/json-schema');

const winccoa = new WinccoaManager();

/**
 * Internal cache — rebuilt on demand and invalidated on sysConnect / CNS events.
 *
 * {
 *   instances: Array<ObjectInstance>,
 *   dpeMap: Map<elementId, dpeName>   — only for leaf DPE nodes
 * }
 */
let _cache = null;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Return all i3X ObjectInstance objects, optionally filtered.
 * @param {{ parentId?: string, typeId?: string }} [filter]
 */
async function buildObjectInstanceList(filter) {
  const cache = await getCache();
  let result = cache.instances;

  if (filter) {
    if (filter.parentId !== undefined) {
      result = result.filter(obj => obj.parentId === filter.parentId);
    }
    if (filter.typeId !== undefined) {
      result = result.filter(obj => obj.typeId === filter.typeId);
    }
  }

  return result;
}

/**
 * Get specific ObjectInstances by elementId array.
 * @param {string[]} elementIds  plain CNS paths e.g. ["pump1", "pump1/alert/controlFuse"]
 */
async function getObjectInstancesByIds(elementIds) {
  const cache = await getCache();
  const idSet = new Set(elementIds);
  return cache.instances.filter(obj => idSet.has(obj.elementId));
}

/**
 * Get objects related to a given elementId via a relationship type.
 * @param {string[]} elementIds
 * @param {string} relationshipType
 */
async function getRelatedObjects(elementIds, relationshipType) {
  const cache = await getCache();
  const result = [];
  const seen = new Set();

  for (const eid of elementIds) {
    let matches = [];

    if (relationshipType === undefined) {
      // Return all related: children + parent (if any)
      const children = cache.instances.filter(o => o.parentId === eid);
      matches = [...children];
      const self = cache.instances.find(o => o.elementId === eid);
      if (self && self.parentId && self.parentId !== '/') {
        const parent = cache.instances.find(o => o.elementId === self.parentId);
        if (parent) matches.push(parent);
      }
    } else if (relationshipType === 'HasChildren') {
      matches = cache.instances.filter(o => o.parentId === eid);
    } else if (relationshipType === 'HasParent') {
      const self = cache.instances.find(o => o.elementId === eid);
      if (self && self.parentId && self.parentId !== '/') {
        const parent = cache.instances.find(o => o.elementId === self.parentId);
        if (parent) matches = [parent];
      }
    } else if (relationshipType === 'HasComponent') {
      matches = cache.instances.filter(o => o.parentId === eid);
    } else if (relationshipType === 'ComponentOf') {
      const self = cache.instances.find(o => o.elementId === eid);
      if (self && self.parentId && self.parentId !== '/') {
        const parent = cache.instances.find(o => o.elementId === self.parentId && o.isComposition);
        if (parent) matches = [parent];
      }
    }

    for (const m of matches) {
      if (!seen.has(m.elementId)) {
        seen.add(m.elementId);
        result.push(m);
      }
    }
  }

  return result;
}

/**
 * Resolve a plain elementId (CNS path) to a WinCC OA DPE address for dpGet/dpSet.
 * Returns null if the elementId is not a leaf DPE.
 * @param {string} elementId  plain CNS path e.g. "pump1/alert/controlFuse"
 */
async function elementIdToDpe(elementId) {
  const cache = await getCache();
  return cache.dpeMap.get(elementId) || null;
}

/**
 * Invalidate the cache — call on sysConnect DP/type events or CNS changes.
 */
function invalidateCache() {
  _cache = null;
  console.info('Hierarchy cache invalidated');
}

/**
 * Strip the system-name prefix from a WinCC OA DP name.
 * e.g. "System1:_mp_ANALOG1" → "_mp_ANALOG1"
 * Falls back to the original name if dpSubStr fails.
 * @param {string} dpName  plain DP name (no trailing dot)
 * @returns {string}
 */
function stripSystemPrefix(dpName) {
  try {
    return winccoa.dpSubStr(dpName + '.', WinccoaDpSub.DP);
  } catch (_e) {
    return dpName;
  }
}

// ── Internal: cache build ─────────────────────────────────────────────────

async function getCache() {
  if (_cache) return _cache;
  _cache = await buildCache();
  return _cache;
}

async function buildCache() {
  const instances = [];
  const dpeMap = new Map();

  const hierarchyView = config.cns.hierarchyView;
  const systemName = winccoa.getSystemName();
  const viewPath = `${systemName}.${hierarchyView}`;

  let trees = [];
  try {
    trees = winccoa.cnsGetTrees(viewPath) || [];
  } catch (err) {
    console.warn(`Could not read CNS hierarchy view "${hierarchyView}":`, String(err));
  }

  if (trees.length > 0) {
    for (const treePath of trees) {
      await traverseCnsNode(treePath, '/', '', instances, dpeMap);
    }
  } else {
    console.info(`CNS hierarchy view "${hierarchyView}" is empty or unavailable — falling back to dpNames enumeration`);
    buildInstancesFromDpNames(instances, dpeMap);
  }

  return { instances, dpeMap };
}

// WinCC OA built-in primitive type names — these are used as leaf typeIds,
// not user-defined DP types.  Enumerating DPs of these types would return
// millions of internal system DPs, so we skip them in the fallback.
const PRIMITIVE_TYPE_NAMES = new Set([
  'Float', 'Long', 'ULong', 'Int', 'UInt', 'Bool',
  'String', 'LangString', 'Char', 'Time', 'Blob',
  'Bit32', 'Bit64', 'Dpid', 'Typeref',
]);

// Maximum DPs per type before we skip child expansion (memory safeguard).
const MAX_EXPAND_INSTANCES = 500;

/**
 * Fallback: build ObjectInstance list directly from dpNames() when no CNS
 * hierarchy view is configured.  Creates one Level-1 instance per DP and
 * expands its type structure into Level-2/3 children (capped to avoid
 * memory blow-up for very large types).
 */
function buildInstancesFromDpNames(instances, dpeMap) {
  const typeNames = winccoa.dpTypes('*');

  for (const typeName of typeNames) {
    if (typeName.startsWith('_')) continue;
    if (PRIMITIVE_TYPE_NAMES.has(typeName)) continue;

    const nsUri = typeNameToUri(typeName);
    let dpList = [];
    try {
      dpList = winccoa.dpNames('*', typeName) || [];
    } catch (err) {
      console.warn(`dpNames failed for type "${typeName}":`, String(err));
      continue;
    }

    const typeNode = winccoa.dpTypeGet(typeName, true);
    const shouldExpand = dpList.length <= MAX_EXPAND_INSTANCES;

    if (!shouldExpand) {
      console.info(`Type "${typeName}" has ${dpList.length} instances — skipping child expansion`);
    }

    for (const dpName of dpList) {
      const localName = stripSystemPrefix(dpName);
      // Skip internal WinCC OA datapoints (names starting with "_")
      if (localName.startsWith('_')) continue;
      const elemId = localName;

      instances.push({
        elementId: elemId,
        displayName: localName,
        typeId: typeName,
        parentId: '/',
        isComposition: true,
        namespaceUri: nsUri,
      });

      if (shouldExpand && typeNode && typeNode.children && typeNode.children.length > 0) {
        expandDpChildren(typeNode.children, elemId, elemId, dpName, nsUri, instances, dpeMap, '');
      }
    }
  }
}

/**
 * Recursively traverse a CNS node.
 *
 * @param {string} fullCnsPath   Full CNS node path e.g. "System1.I3X_Hierarchy:Plant1/Area1"
 * @param {string} parentElemId  Parent elementId (or '/' for roots)
 * @param {string} cnsRelPath    Accumulated path relative to the view root
 * @param {Array}  instances
 * @param {Map}    dpeMap
 */
async function traverseCnsNode(fullCnsPath, parentElemId, cnsRelPath, instances, dpeMap) {
  const colonIdx = fullCnsPath.lastIndexOf(':');
  const pathAfterColon = colonIdx >= 0 ? fullCnsPath.slice(colonIdx + 1) : fullCnsPath;
  const slashIdx = pathAfterColon.lastIndexOf('/');
  const nodeName = slashIdx >= 0 ? pathAfterColon.slice(slashIdx + 1) : pathAfterColon;

  const cnsPath = cnsRelPath ? `${cnsRelPath}/${nodeName}` : nodeName;
  const myElemId = cnsPath;   // plain path — no obj: prefix

  let dpData = null;
  try {
    const rows = await winccoa.dpQuery(
      `SELECT '_address.._value' FROM "${fullCnsPath}"`
    );
    if (rows && rows.length > 1 && rows[1] && rows[1][1] !== undefined) {
      const val = rows[1][1];
      if (typeof val === 'string' && val.trim() !== '') {
        dpData = val.trim();
      }
    }
  } catch (_e) {
    // Node has no linked DP — treat as folder
  }

  let isFolder = !dpData;
  let nsUri = getSystemUri();

  if (!isFolder) {
    const dpName = dpData.endsWith('.') ? dpData.slice(0, -1) : dpData;
    const localDpName = stripSystemPrefix(dpName);
    // Skip internal WinCC OA datapoints (names starting with "_")
    if (localDpName.startsWith('_')) {
      isFolder = true;
    }
  }

  if (!isFolder) {
    const dpName = dpData.endsWith('.') ? dpData.slice(0, -1) : dpData;
    let dpTypeName = null;
    try {
      dpTypeName = winccoa.dpTypeName(`${dpName}.`);
    } catch (_e) { /* dp may not exist */ }

    if (dpTypeName && !dpTypeName.startsWith('_')) {
      nsUri = typeNameToUri(dpTypeName);

      instances.push({
        elementId: myElemId,
        displayName: nodeName,
        typeId: dpTypeName,         // plain type name e.g. "PumpType"
        parentId: parentElemId,
        isComposition: true,
        namespaceUri: nsUri,
      });

      const typeNode = winccoa.dpTypeGet(dpTypeName, true);
      if (typeNode && typeNode.children && typeNode.children.length > 0) {
        expandDpChildren(typeNode.children, myElemId, myElemId, dpName, nsUri, instances, dpeMap, '');
      }
    } else {
      console.warn('Unknown DP type for CNS data:', dpData, '— treating as folder');
      isFolder = true;
    }
  }

  if (isFolder) {
    instances.push({
      elementId: myElemId,
      displayName: nodeName,
      typeId: 'FolderType',         // plain name
      parentId: parentElemId,
      isComposition: true,
      namespaceUri: nsUri,
    });
  }

  let children = [];
  try {
    children = winccoa.cnsGetChildren(fullCnsPath) || [];
  } catch (_e) { /* leaf node */ }

  for (const childPath of children) {
    await traverseCnsNode(childPath, myElemId, cnsPath, instances, dpeMap);
  }
}

/**
 * Recursively expand DP type structure into ObjectInstance leaf nodes.
 *
 * @param {object[]} children
 * @param {string}   parentElemId
 * @param {string}   baseCnsPath     elementId of the DP root node
 * @param {string}   dpName          WinCC OA DP name (no trailing dot)
 * @param {string}   nsUri
 * @param {Array}    instances
 * @param {Map}      dpeMap
 * @param {string}   elemPathPrefix  dot-joined element path so far (empty at root)
 */
function expandDpChildren(children, parentElemId, baseCnsPath, dpName, nsUri, instances, dpeMap, elemPathPrefix) {
  const depth = elemPathPrefix ? elemPathPrefix.split('.').length + 1 : 1;
  console.debug(`[expandDpChildren] depth=${depth} parent=${parentElemId} children=${children.map(c => c.name).join(',')}`);
  for (const child of children) {
    const elemPath = elemPathPrefix ? `${elemPathPrefix}.${child.name}` : child.name;
    // elementId uses slash-separated path segments (no obj: prefix)
    const childElemId = `${baseCnsPath}/${elemPath.replace(/\./g, '/')}`;

    const hasChildren = Array.isArray(child.children) && child.children.length > 0;
    if (hasChildren) {
      // Any node with children (Struct, Typeref, etc.) is a composition
      instances.push({
        elementId: childElemId,
        displayName: child.name,
        typeId: child.type === ET.Struct ? 'object' : elemTypeName(child.type),
        parentId: parentElemId,
        isComposition: true,
        namespaceUri: nsUri,
      });
      expandDpChildren(child.children, childElemId, baseCnsPath, dpName, nsUri, instances, dpeMap, elemPath);
    } else {
      const dpe = `${dpName}.${elemPath}`;
      instances.push({
        elementId: childElemId,
        displayName: child.name,
        typeId: elemTypeName(child.type),
        parentId: parentElemId,
        isComposition: false,
        namespaceUri: nsUri,
      });
      dpeMap.set(childElemId, dpe);
    }
  }
}

module.exports = {
  buildObjectInstanceList,
  getObjectInstancesByIds,
  getRelatedObjects,
  elementIdToDpe,
  invalidateCache,
};
