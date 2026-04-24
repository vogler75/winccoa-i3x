'use strict';

// WinccoaElementType numeric values (from winccoa-nodejs.md / @types/winccoa-manager)
const ET = {
  Struct: 1,
  Char: 19,
  UInt: 20,
  Int: 21,
  Float: 22,
  Bool: 23,
  Bit32: 24,
  String: 25,
  Time: 26,
  Dpid: 27,
  Typeref: 41,
  LangString: 42,
  Blob: 46,
  Bit64: 50,
  Long: 54,
  ULong: 58,
  // Dyn variants (offset +100 from base, approximation — actual values vary)
  // We handle them by name check below
};

/**
 * Map a WinccoaElementType numeric value to a JSON Schema fragment.
 * @param {number} elemType
 * @returns {{ type: string, [format]: string, description: string }}
 */
function elemTypeToSchema(elemType) {
  switch (elemType) {
    case ET.Float:
      return { type: 'number', description: 'Float' };
    case ET.Long:
    case ET.ULong:
      return { type: 'number', description: elemType === ET.Long ? 'Long' : 'ULong' };
    case ET.Int:
      return { type: 'integer', description: 'Int' };
    case ET.UInt:
      return { type: 'integer', description: 'UInt' };
    case ET.Bool:
      return { type: 'boolean', description: 'Bool' };
    case ET.String:
      return { type: 'string', description: 'String' };
    case ET.LangString:
      return { type: 'string', description: 'LangString' };
    case ET.Char:
      return { type: 'string', description: 'Char' };
    case ET.Time:
      return { type: 'string', format: 'date-time', description: 'Time' };
    case ET.Blob:
      return { type: 'string', format: 'byte', description: 'Blob' };
    case ET.Bit32:
      return { type: 'integer', description: 'Bit32' };
    case ET.Bit64:
      return { type: 'integer', description: 'Bit64' };
    case ET.Dpid:
      return { type: 'string', description: 'Dpid' };
    case ET.Typeref:
      // Bare Typeref leaf (no referenced type available). Callers of
      // `dpTypeNodeToSchema` should pass a resolver so the referenced type
      // can be expanded inline instead of hitting this fallback.
      return { type: 'object', description: 'Typeref' };
    default:
      // Dyn* types — treat as array of the base type (best effort)
      return { type: 'array', items: { type: 'string' }, description: `ElementType(${elemType})` };
  }
}

/**
 * Recursively convert a WinccoaDpTypeNode tree to a JSON Schema object.
 *
 * Typeref nodes: prefer inline children when present; otherwise the caller
 * can pass `resolveRef(refName)` that returns the referenced DpTypeNode.
 * `visited` guards against typeref cycles.
 *
 * @param {object} typeNode  WinccoaDpTypeNode
 * @param {(refName: string) => object|null} [resolveRef]
 * @param {Set<string>} [visited]
 * @returns {object} JSON Schema
 */
function dpTypeNodeToSchema(typeNode, resolveRef = null, visited = new Set()) {
  if (typeNode.type === ET.Typeref) {
    if (Array.isArray(typeNode.children) && typeNode.children.length > 0) {
      return structChildrenToSchema(typeNode.children, resolveRef, visited);
    }
    const refName = typeNode.refName;
    if (refName && !visited.has(refName) && typeof resolveRef === 'function') {
      const resolved = resolveRef(refName);
      if (resolved) {
        const next = new Set(visited);
        next.add(refName);
        return dpTypeNodeToSchema(resolved, resolveRef, next);
      }
    }
    return { type: 'object', description: refName ? `Typeref<${refName}>` : 'Typeref' };
  }
  if (typeNode.type === ET.Struct) {
    return structChildrenToSchema(typeNode.children, resolveRef, visited);
  }
  return elemTypeToSchema(typeNode.type);
}

function structChildrenToSchema(children, resolveRef, visited) {
  const properties = {};
  if (Array.isArray(children)) {
    for (const child of children) {
      properties[child.name] = dpTypeNodeToSchema(child, resolveRef, visited);
    }
  }
  return { type: 'object', properties };
}

/**
 * i3X primitive type name for a WinccoaElementType.
 * Used as typeId in ObjectInstance leaf nodes.
 */
function elemTypeName(elemType) {
  const map = {
    [ET.Float]: 'Float',
    [ET.Long]: 'Long',
    [ET.ULong]: 'ULong',
    [ET.Int]: 'Int',
    [ET.UInt]: 'UInt',
    [ET.Bool]: 'Bool',
    [ET.String]: 'String',
    [ET.LangString]: 'LangString',
    [ET.Char]: 'Char',
    [ET.Time]: 'Time',
    [ET.Blob]: 'Blob',
    [ET.Bit32]: 'Bit32',
    [ET.Bit64]: 'Bit64',
    [ET.Dpid]: 'Dpid',
    [ET.Typeref]: 'Typeref',
  };
  return map[elemType] || `Type${elemType}`;
}

module.exports = { dpTypeNodeToSchema, elemTypeToSchema, elemTypeName, ET };
