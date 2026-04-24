'use strict';

const { WinccoaManager, WinccoaDpSub } = require('winccoa-manager');
const config = require('../config');
const { typeNameToUri, getSystemUri } = require('./namespaces');
const { ET, elemTypeName } = require('../utils/json-schema');

const winccoa = new WinccoaManager();

/**
 * Internal cache — rebuilt on demand and invalidated on sysConnect/CNS events.
 *
 *   instances:  Array<ObjectInstance>           — one per browsable node
 *   valueMap:   Map<elementId, DpInfo>          — value-access metadata
 *   typeNodes:  Map<typeName, WinccoaDpTypeNode>— memoised dpTypeGet results
 *
 * The object graph mirrors WinCC OA's natural shape (OPC UA-style):
 *   - CNS folder                     → isComposition=true, typeElementId=FolderType
 *   - DP root (struct)               → isComposition=true, typeElementId=<DpType>
 *   - DP root (primitive/scalar)     → isComposition=false, typeElementId=<DpType>
 *   - Struct sub-node (inline)       → isComposition=true, typeElementId='object'
 *   - Struct sub-node (Typeref)      → isComposition=true, typeElementId=<referenced DpType>
 *   - Primitive leaf element         → isComposition=false, typeElementId='Float'/…
 *
 * DpInfo shape (present for every node that maps to a DP or DPE):
 *   { dpName, typeName, subPath }
 *     - dpName:   WinCC OA DP name, with system prefix if any
 *     - typeName: outer DP type name (same for every node under a given DP)
 *     - subPath:  dot-separated element path within the DP. '' = root.
 */
let _cache = null;

// ── Public API ────────────────────────────────────────────────────────────

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
      result = result.filter(obj => obj.parentId === null);
    }
  }
  return result;
}

async function getObjectInstancesByIds(elementIds) {
  const cache = await getCache();
  const idSet = new Set(elementIds);
  return cache.instances.filter(obj => idSet.has(obj.elementId));
}

async function getRelatedObjects(elementIds, relationshipType) {
  const cache = await getCache();
  const result = [];
  const seen = new Set();

  for (const eid of elementIds) {
    let matches = [];

    if (relationshipType === undefined) {
      const children = cache.instances.filter(o => o.parentId === eid);
      matches = [...children];
      const self = cache.instances.find(o => o.elementId === eid);
      if (self && self.parentId) {
        const parent = cache.instances.find(o => o.elementId === self.parentId);
        if (parent) matches.push(parent);
      }
    } else if (relationshipType === 'HasChildren' || relationshipType === 'HasComponent') {
      matches = cache.instances.filter(o => o.parentId === eid);
    } else if (relationshipType === 'HasParent' || relationshipType === 'ComponentOf') {
      const self = cache.instances.find(o => o.elementId === eid);
      if (self && self.parentId) {
        const parent = cache.instances.find(o => o.elementId === self.parentId);
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

async function getObjectValueInfo(elementId) {
  const cache = await getCache();
  return cache.valueMap.get(elementId) || null;
}

/**
 * Build a CESMII-style `metadata.relationships` map for an elementId:
 *   { HasParent: "...", HasComponent: ["...", ...] }
 * Keys are omitted when empty.
 */
async function getRelationships(elementId) {
  const cache = await getCache();
  const self = cache.instances.find(o => o.elementId === elementId);
  if (!self) return null;

  const out = {};
  if (self.parentId) out.HasParent = self.parentId;

  const children = cache.instances
    .filter(o => o.parentId === elementId)
    .map(o => o.elementId);
  if (children.length > 0) out.HasComponent = children;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Resolve an elementId to a single DPE string. Returns null for composite
 * nodes (Struct/Typeref — they don't have a single DPE) and for folders/unknowns.
 */
async function elementIdToDpe(elementId) {
  const info = await getObjectValueInfo(elementId);
  if (!info) return null;
  const cache = await getCache();
  const typeNode = await getTypeNode(info.typeName);
  if (!typeNode) return null;
  const sub = findTypeNode(typeNode, info.subPath ? info.subPath.split('.') : [], cache.typeNodes);
  if (!sub || isComposite(sub)) return null;
  return buildDpeAddress(info);
}

function buildDpeAddress({ dpName, subPath }) {
  return subPath ? `${dpName}.${subPath}` : `${dpName}.`;
}

async function getTypeNode(typeName) {
  const cache = await getCache();
  if (cache.typeNodes.has(typeName)) return cache.typeNodes.get(typeName);
  let node = null;
  try { node = winccoa.dpTypeGet(typeName, true); } catch (_e) { /* missing type */ }
  cache.typeNodes.set(typeName, node);
  return node;
}

function invalidateCache() {
  _cache = null;
  console.info('Hierarchy cache invalidated');
}

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
  const valueMap = new Map();
  const typeNodes = new Map();

  const hierarchyViewsRaw = config.cns.hierarchyViews || config.cns.hierarchyView || 'I3X_Hierarchy';
  const hierarchyViews = Array.isArray(hierarchyViewsRaw) ? hierarchyViewsRaw : [hierarchyViewsRaw];
  const systemName = winccoa.getSystemName().replace(/:$/, '');

  let anyTrees = false;
  for (const viewName of hierarchyViews) {
    const viewPath = `${systemName}.${viewName}:`;
    let trees = [];
    try {
      trees = winccoa.cnsGetTrees(viewPath) || [];
    } catch (err) {
      console.warn(`Could not read CNS hierarchy view "${viewName}":`, String(err));
    }
    if (trees.length > 0) {
      anyTrees = true;
      for (const treePath of trees) {
        await traverseCnsNode(treePath, null, '', instances, valueMap, typeNodes);
      }
    }
  }

  if (!anyTrees) {
    console.info('No CNS hierarchy views found — falling back to dpNames enumeration');
    buildInstancesFromDpNames(instances, valueMap, typeNodes);
  }

  return { instances, valueMap, typeNodes };
}

const PRIMITIVE_TYPE_NAMES = new Set([
  'Float', 'Long', 'ULong', 'Int', 'UInt', 'Bool',
  'String', 'LangString', 'Char', 'Time', 'Blob',
  'Bit32', 'Bit64', 'Dpid', 'Typeref',
]);

function buildInstancesFromDpNames(instances, valueMap, typeNodes) {
  const typeNameList = winccoa.dpTypes('*');

  for (const typeName of typeNameList) {
    if (typeName.startsWith('_')) continue;
    if (PRIMITIVE_TYPE_NAMES.has(typeName)) continue;

    let dpList = [];
    try {
      dpList = winccoa.dpNames('*', typeName) || [];
    } catch (err) {
      console.warn(`dpNames failed for type "${typeName}":`, String(err));
      continue;
    }
    for (const dpName of dpList) {
      const localName = stripSystemPrefix(dpName);
      if (localName.startsWith('_')) continue;
      addDpInstance(localName, localName, null, dpName, typeName, instances, valueMap, typeNodes);
    }
  }
}

/**
 * Push the DP root ObjectInstance and recursively expand every level of its
 * type tree into sub-ObjectInstances. OPC UA-style: each node — struct or
 * primitive — becomes a browsable entity with its own elementId.
 */
function addDpInstance(elementId, displayName, parentId, dpName, typeName, instances, valueMap, typeNodes) {
  const typeNode = resolveTypeNode(typeName, typeNodes);
  const rootIsComposite = typeNode && isComposite(typeNode);
  const nsUri = typeNameToUri(typeName);

  instances.push({
    elementId,
    displayName,
    typeElementId: typeName,
    parentId,
    isComposition: !!rootIsComposite,
    namespaceUri: nsUri,
  });
  valueMap.set(elementId, { dpName, typeName, subPath: '' });

  if (rootIsComposite) {
    const children = getEffectiveChildren(typeNode, typeNodes);
    if (children.length > 0) {
      const visited = typeNode.type === ET.Typeref && typeNode.refName
        ? new Set([typeNode.refName])
        : new Set();
      expandTypeChildren(children, elementId, elementId, dpName, typeName, nsUri, instances, valueMap, '', typeNodes, visited);
    }
  }
}

/**
 * Recursively push ObjectInstances for the children of a struct type node.
 *
 *   parentElemId:    elementId to use as parentId on each pushed child
 *   rootElemId:      DP-root elementId — used to build child elementIds
 *   dpName/typeName: parent DP identity (same for every descendant)
 *   elemPathPrefix:  dot-joined path from the DP root to the current level
 *   typeNodes:       shared type-node cache (for resolving Typeref refNames)
 *   visitedRefs:     Typeref refNames on the current path — guards against cycles
 */
function expandTypeChildren(children, parentElemId, rootElemId, dpName, typeName, nsUri, instances, valueMap, elemPathPrefix, typeNodes, visitedRefs = new Set()) {
  for (const child of children) {
    const subPath = elemPathPrefix ? `${elemPathPrefix}.${child.name}` : child.name;
    const childElemId = `${rootElemId}/${subPath.replace(/\./g, '/')}`;
    const isStruct = child.type === ET.Struct;
    const isTyperef = child.type === ET.Typeref;
    const composite = isStruct || isTyperef;

    let typeElementId;
    if (isStruct) typeElementId = 'object';
    else if (isTyperef) typeElementId = child.refName || 'Typeref';
    else typeElementId = elemTypeName(child.type);

    instances.push({
      elementId: childElemId,
      displayName: child.name,
      typeElementId,
      parentId: parentElemId,
      isComposition: composite,
      namespaceUri: nsUri,
    });
    valueMap.set(childElemId, { dpName, typeName, subPath });

    if (!composite) continue;

    if (isTyperef && child.refName && visitedRefs.has(child.refName)) continue;

    const effective = getEffectiveChildren(child, typeNodes);
    if (effective.length === 0) continue;

    const nextVisited = isTyperef && child.refName
      ? new Set(visitedRefs).add(child.refName)
      : visitedRefs;

    expandTypeChildren(effective, childElemId, rootElemId, dpName, typeName, nsUri, instances, valueMap, subPath, typeNodes, nextVisited);
  }
}

function resolveTypeNode(typeName, typeNodes) {
  if (typeNodes.has(typeName)) return typeNodes.get(typeName);
  let node = null;
  try { node = winccoa.dpTypeGet(typeName, true); } catch (_e) { node = null; }
  typeNodes.set(typeName, node);
  return node;
}

function isComposite(node) {
  return !!node && (node.type === ET.Struct || node.type === ET.Typeref);
}

/**
 * Return the children to traverse for a composite node. For a Struct, that's
 * its own `children` array. For a Typeref, prefer inline children when the
 * winccoa-manager has pre-expanded them (includeSubTypes=true can inline
 * referenced types); otherwise resolve via `refName` to the referenced
 * DpType's children. Returns `[]` for leaves or unresolvable refs.
 */
function getEffectiveChildren(node, typeNodes) {
  if (!node) return [];
  if (Array.isArray(node.children) && node.children.length > 0) return node.children;
  if (node.type === ET.Typeref && node.refName) {
    const ref = resolveTypeNode(node.refName, typeNodes);
    if (ref && Array.isArray(ref.children)) return ref.children;
  }
  return [];
}

function findTypeNode(node, segments, typeNodes) {
  if (!node || !segments.length) return node;
  const children = getEffectiveChildren(node, typeNodes);
  const [head, ...tail] = segments;
  const child = children.find(c => c.name === head);
  return tail.length ? findTypeNode(child, tail, typeNodes) : child;
}

/**
 * Walk a CNS view. Folder nodes become FolderType compositions; DP-linked
 * nodes become fully-expanded DP subtrees rooted at the CNS elementId.
 */
async function traverseCnsNode(fullCnsPath, parentElemId, cnsRelPath, instances, valueMap, typeNodes) {
  const colonIdx = fullCnsPath.lastIndexOf(':');
  const pathAfterColon = colonIdx >= 0 ? fullCnsPath.slice(colonIdx + 1) : fullCnsPath;
  const sepIdx = Math.max(pathAfterColon.lastIndexOf('/'), pathAfterColon.lastIndexOf('.'));
  const nodeName = sepIdx >= 0 ? pathAfterColon.slice(sepIdx + 1) : pathAfterColon;

  const cnsPath = cnsRelPath ? `${cnsRelPath}/${nodeName}` : nodeName;
  const myElemId = cnsPath;

  let dpData = null;
  try {
    const rows = await winccoa.dpQuery(`SELECT '_address.._value' FROM "${fullCnsPath}"`);
    if (rows && rows.length > 1 && rows[1] && rows[1][1] !== undefined) {
      const val = rows[1][1];
      if (typeof val === 'string' && val.trim() !== '') dpData = val.trim();
    }
  } catch (_e) { /* no linked DP */ }

  let pushedEntity = false;

  if (dpData) {
    const dpName = dpData.endsWith('.') ? dpData.slice(0, -1) : dpData;
    const localDpName = stripSystemPrefix(dpName);

    if (!localDpName.startsWith('_')) {
      const colonPos = dpName.indexOf(':');
      const nameAfterColon = colonPos >= 0 ? dpName.slice(colonPos + 1) : dpName;
      const dotIdx = nameAfterColon.indexOf('.');

      if (dotIdx === -1) {
        // DP root linked → full expansion
        let typeName = null;
        try { typeName = winccoa.dpTypeName(`${dpName}.`); } catch (_e) {}
        if (typeName && !typeName.startsWith('_')) {
          addDpInstance(myElemId, nodeName, parentElemId, dpName, typeName, instances, valueMap, typeNodes);
          pushedEntity = true;
        }
      } else {
        // A specific element of a DP linked — expand from that sub-path.
        const dpRootLocal = nameAfterColon.slice(0, dotIdx);
        const dpRoot = colonPos >= 0
          ? `${dpName.slice(0, colonPos + 1)}${dpRootLocal}`
          : dpRootLocal;
        const subPath = nameAfterColon.slice(dotIdx + 1);

        let typeName = null;
        try { typeName = winccoa.dpTypeName(`${dpRoot}.`); } catch (_e) {}
        if (typeName && !typeName.startsWith('_')) {
          const typeNode = resolveTypeNode(typeName, typeNodes);
          const subNode = findTypeNode(typeNode, subPath.split('.'), typeNodes);
          const subIsStruct = subNode && subNode.type === ET.Struct;
          const subIsTyperef = subNode && subNode.type === ET.Typeref;
          const subComposite = subIsStruct || subIsTyperef;
          const nsUri = typeNameToUri(typeName);

          let subTypeElementId;
          if (subIsStruct) subTypeElementId = 'object';
          else if (subIsTyperef) subTypeElementId = subNode.refName || 'Typeref';
          else subTypeElementId = subNode ? elemTypeName(subNode.type) : 'object';

          instances.push({
            elementId: myElemId,
            displayName: nodeName,
            typeElementId: subTypeElementId,
            parentId: parentElemId,
            isComposition: !!subComposite,
            namespaceUri: nsUri,
          });
          valueMap.set(myElemId, { dpName: dpRoot, typeName, subPath });

          if (subComposite) {
            const effective = getEffectiveChildren(subNode, typeNodes);
            if (effective.length > 0) {
              const visited = subIsTyperef && subNode.refName
                ? new Set([subNode.refName])
                : new Set();
              expandTypeChildren(effective, myElemId, myElemId, dpRoot, typeName, nsUri, instances, valueMap, subPath, typeNodes, visited);
            }
          }
          pushedEntity = true;
        }
      }
    }
  }

  if (!pushedEntity) {
    instances.push({
      elementId: myElemId,
      displayName: nodeName,
      typeElementId: 'FolderType',
      parentId: parentElemId,
      isComposition: true,
      namespaceUri: getSystemUri(),
    });
    let children = [];
    try { children = winccoa.cnsGetChildren(fullCnsPath) || []; } catch (_e) {}
    for (const childPath of children) {
      await traverseCnsNode(childPath, myElemId, cnsPath, instances, valueMap, typeNodes);
    }
  }
}

// ── Leaf-walking helper (value/subscription readers) ──────────────────────

async function collectDpeLeaves(info) {
  const cache = await getCache();
  const rootType = await getTypeNode(info.typeName);
  if (!rootType) return [];
  const startNode = findTypeNode(rootType, info.subPath ? info.subPath.split('.') : [], cache.typeNodes);
  if (!startNode) return [];

  const out = [];
  function walk(node, relPath, visitedRefs) {
    if (isComposite(node)) {
      if (node.type === ET.Typeref && node.refName && visitedRefs.has(node.refName)) return;
      const children = getEffectiveChildren(node, cache.typeNodes);
      const nextVisited = node.type === ET.Typeref && node.refName
        ? new Set(visitedRefs).add(node.refName)
        : visitedRefs;
      for (const child of children) {
        walk(child, relPath ? `${relPath}.${child.name}` : child.name, nextVisited);
      }
      return;
    }
    const dpe = buildDpeAddress({
      dpName: info.dpName,
      subPath: info.subPath
        ? (relPath ? `${info.subPath}.${relPath}` : info.subPath)
        : relPath,
    });
    out.push({ relPath, dpe });
  }
  const initialVisited = startNode.type === ET.Typeref && startNode.refName
    ? new Set([startNode.refName])
    : new Set();
  walk(startNode, '', initialVisited);
  return out;
}

module.exports = {
  buildObjectInstanceList,
  getObjectInstancesByIds,
  getRelatedObjects,
  getRelationships,
  elementIdToDpe,
  getObjectValueInfo,
  collectDpeLeaves,
  getTypeNode,
  invalidateCache,
};
