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
 * @param {{ parentId?: string, typeElementId?: string, root?: boolean }} [filter]
 */
async function buildObjectInstanceList(filter) {
  const cache = await getCache();
  let result = cache.instances;

  if (filter) {
    if (filter.parentId !== undefined) {
      result = result.filter(obj => obj.parentId === filter.parentId);
    }
    if (filter.typeElementId !== undefined) {
      result = result.filter(obj => obj.typeElementId === filter.typeElementId);
    }
    if (filter.root === true) {
      result = result.filter(obj => obj.parentId === '/' || obj.parentId === null || obj.parentId === undefined);
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
 * Collect all leaf DPE descendants of a single elementId, walking at most
 * `maxDepth - 1` levels deep. `maxDepth === 0` means unlimited.
 *
 * Returns [{ elementId, relPath, dpe }] where relPath is the slash-joined
 * path from the root to the leaf. Composition nodes themselves are never
 * returned — only leaves that have a DPE mapping.
 *
 * @param {string} rootElementId
 * @param {number} maxDepth  0 = unlimited, 1 = no recursion (empty), N>1 = up to N-1 levels down
 * @returns {Promise<Array<{elementId: string, relPath: string, dpe: string}>>}
 */
async function collectLeafDescendants(rootElementId, maxDepth) {
  if (maxDepth === 1) return [];

  const cache = await getCache();
  const budget = maxDepth === 0 ? Infinity : maxDepth - 1;
  const out = [];

  function walk(parentEid, depthLeft) {
    if (depthLeft <= 0) return;
    const children = cache.instances.filter(o => o.parentId === parentEid);
    for (const c of children) {
      if (c.isComposition) {
        walk(c.elementId, depthLeft - 1);
      } else {
        const dpe = cache.dpeMap.get(c.elementId);
        if (!dpe) continue;
        const relPath = c.elementId.startsWith(rootElementId + '/')
          ? c.elementId.slice(rootElementId.length + 1)
          : c.elementId;
        out.push({ elementId: c.elementId, relPath, dpe });
      }
    }
  }

  walk(rootElementId, budget);
  return out;
}

/**
 * Resolve elementIds to leaf DPE elementIds, expanding up to maxDepth levels.
 * At the depth boundary, composition nodes that still have children are
 * omitted — they would otherwise be silently dropped downstream because
 * they do not resolve to a DPE via elementIdToDpe().
 */
async function resolveLeafIds(elementIds, maxDepth = 1) {
  if (maxDepth <= 1) return elementIds;

  const all = await buildObjectInstanceList();
  const result = new Set();

  function expand(ids, depth) {
    for (const eid of ids) {
      const children = all.filter(o => o.parentId === eid);
      if (children.length === 0) {
        result.add(eid);
      } else if (depth > 1) {
        expand(children.map(c => c.elementId), depth - 1);
      }
    }
  }

  expand(elementIds, maxDepth);
  return [...result];
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

  const hierarchyViewsRaw = config.cns.hierarchyViews || config.cns.hierarchyView || 'I3X_Hierarchy';
  const hierarchyViews = Array.isArray(hierarchyViewsRaw) ? hierarchyViewsRaw : [hierarchyViewsRaw];
  const systemName = winccoa.getSystemName().replace(/:$/, '');  // strip trailing colon

  let anyTrees = false;
  for (const viewName of hierarchyViews) {
    const viewPath = `${systemName}.${viewName}:`;  // correct format: "System1.I3X_Hierarchy:"
    let trees = [];
    try {
      trees = winccoa.cnsGetTrees(viewPath) || [];
    } catch (err) {
      console.warn(`Could not read CNS hierarchy view "${viewName}":`, String(err));
    }
    if (trees.length > 0) {
      anyTrees = true;
      for (const treePath of trees) {
        await traverseCnsNode(treePath, '/', '', instances, dpeMap);
      }
    }
  }

  if (!anyTrees) {
    console.info('No CNS hierarchy views found — falling back to dpNames enumeration');
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

    let dpList = [];
    try {
      dpList = winccoa.dpNames('*', typeName) || [];
    } catch (err) {
      console.warn(`dpNames failed for type "${typeName}":`, String(err));
      continue;
    }
    const shouldExpand = dpList.length <= MAX_EXPAND_INSTANCES;
    if (!shouldExpand) {
      console.info(`Type "${typeName}" has ${dpList.length} instances — skipping child expansion`);
    }
    for (const dpName of dpList) {
      const localName = stripSystemPrefix(dpName);
      if (localName.startsWith('_')) continue;
      addDpInstance(localName, localName, '/', dpName, typeName, shouldExpand, instances, dpeMap);
    }
  }
}

/**
 * Walk a dpTypeGet node tree to find the sub-node at `segments` path.
 */
function findTypeNode(node, segments) {
  if (!node || !segments.length) return node;
  const [head, ...tail] = segments;
  const child = (node.children || []).find(c => c.name === head);
  return tail.length ? findTypeNode(child, tail) : child;
}

/**
 * Process a single DP root: push instance + expand type children.
 * Shared between CNS traversal and dpNames fallback.
 */
function addDpInstance(elementId, displayName, parentId, dpName, typeName, shouldExpand, instances, dpeMap) {
  const nsUri = typeNameToUri(typeName);
  instances.push({
    elementId,
    displayName,
    typeElementId: typeName,
    parentId,
    isComposition: true,
    namespaceUri: nsUri,
  });
  if (shouldExpand) {
    const typeNode = winccoa.dpTypeGet(typeName, true);
    if (typeNode && typeNode.children && typeNode.children.length > 0) {
      expandDpChildren(typeNode.children, elementId, elementId, dpName, nsUri, instances, dpeMap, '');
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
  // ── Step 1: Extract node name ──────────────────────────────────────────
  // CNS child paths use '.' as separator (e.g. "System1.I3X_Hierarchy:Plant1.pumpe1a")
  const colonIdx = fullCnsPath.lastIndexOf(':');
  const pathAfterColon = colonIdx >= 0 ? fullCnsPath.slice(colonIdx + 1) : fullCnsPath;
  const sepIdx = Math.max(pathAfterColon.lastIndexOf('/'), pathAfterColon.lastIndexOf('.'));
  const nodeName = sepIdx >= 0 ? pathAfterColon.slice(sepIdx + 1) : pathAfterColon;

  const cnsPath = cnsRelPath ? `${cnsRelPath}/${nodeName}` : nodeName;
  const myElemId = cnsPath;

  // ── Step 2: Query linked DP/DPE from CNS node ─────────────────────────
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
  } catch (_e) { /* no linked DP */ }

  console.info(`[CNS] "${myElemId}" dpData=${dpData || '(none)'}`);

  // ── Step 3: Dispatch by node type ──────────────────────────────────────
  let isFolder = true;

  if (dpData) {
    const dpName = dpData.endsWith('.') ? dpData.slice(0, -1) : dpData;
    const localDpName = stripSystemPrefix(dpName);

    if (!localDpName.startsWith('_')) {
      // Determine DP root vs DPE: strip only "System1:" colon-prefix,
      // keep element path intact. (stripSystemPrefix strips element path too!)
      const colonPos = dpName.indexOf(':');
      const nameAfterColon = colonPos >= 0 ? dpName.slice(colonPos + 1) : dpName;
      const dotIdx = nameAfterColon.indexOf('.');

      if (dotIdx === -1) {
        // ── DP ROOT ("pumpe1a") ──────────────────────────────────────
        // Same as buildInstancesFromDpNames — call shared addDpInstance()
        let typeName = null;
        try { typeName = winccoa.dpTypeName(`${dpName}.`); } catch (_e) {}

        if (typeName && !typeName.startsWith('_')) {
          addDpInstance(myElemId, nodeName, parentElemId, dpName, typeName, true, instances, dpeMap);
          isFolder = false;
        }

      } else {
        // ── DPE PATH ("pumpe1a.speed" or "pumpe1a.config.maxSpeed") ──
        const dpRootLocal = nameAfterColon.slice(0, dotIdx);
        const dpRoot = colonPos >= 0
          ? `${dpName.slice(0, colonPos + 1)}${dpRootLocal}`
          : dpRootLocal;
        const elemPath = nameAfterColon.slice(dotIdx + 1);

        let typeName = null;
        try { typeName = winccoa.dpTypeName(`${dpRoot}.`); } catch (_e) {}

        if (typeName && !typeName.startsWith('_')) {
          const nsUri = typeNameToUri(typeName);
          const typeNode = winccoa.dpTypeGet(typeName, true);
          const subNode = findTypeNode(typeNode, elemPath.split('.'));

          if (subNode && subNode.children && subNode.children.length > 0) {
            // Struct sub-node → expand its children
            instances.push({
              elementId: myElemId, displayName: nodeName, typeElementId: 'object',
              parentId: parentElemId, isComposition: true, namespaceUri: nsUri,
            });
            expandDpChildren(subNode.children, myElemId, myElemId, dpRoot, nsUri, instances, dpeMap, elemPath);
          } else {
            // Leaf DPE → add to dpeMap for value access
            const leafType = subNode ? elemTypeName(subNode.type) : 'unknown';
            instances.push({
              elementId: myElemId, displayName: nodeName, typeElementId: leafType,
              parentId: parentElemId, isComposition: false, namespaceUri: nsUri,
            });
            dpeMap.set(myElemId, dpName);
          }
          isFolder = false;
        }
      }
    }
  }

  // ── FOLDER: no DP link, or link could not be resolved ──────────────────
  if (isFolder) {
    instances.push({
      elementId: myElemId, displayName: nodeName, typeElementId: 'FolderType',
      parentId: parentElemId, isComposition: true, namespaceUri: getSystemUri(),
    });
    // Only recurse CNS children for folder nodes.
    // DP-linked nodes get their children from expandDpChildren instead.
    let children = [];
    try {
      children = winccoa.cnsGetChildren(fullCnsPath) || [];
    } catch (_e) { /* leaf CNS node */ }
    for (const childPath of children) {
      await traverseCnsNode(childPath, myElemId, cnsPath, instances, dpeMap);
    }
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
        typeElementId: child.type === ET.Struct ? 'object' : elemTypeName(child.type),
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
        typeElementId: elemTypeName(child.type),
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
  resolveLeafIds,
  collectLeafDescendants,
  invalidateCache,
};
