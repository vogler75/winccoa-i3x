# i3X API — WinCC OA Mapping Reference

Source: CESMII i3X spec (github.com/cesmii/i3X), OpenAPI 0.0.1, live demo at api.i3x.dev/v0

---

## Conceptual Overview

| i3x Concept | Description | WinCC OA Mapping |
|---|---|---|
| **Namespace** | Logical container preventing naming collisions; groups related types | One namespace per **DP type** |
| **Object** | An instance of a type, carrying attributes (data points) | **DP instances**, expanded into struct nodes and leaf elements |
| **Hierarchy** | Parent-child tree giving context to objects (enterprise → site → area → line → equipment → sensor) | CNS view `I3X_Hierarchy` |

---

## 1. Namespaces — `GET /namespaces`

A namespace is a logical scope that groups related **object types** (DP types) and their **objects** (DP instances). Every DP type defines its own namespace — this prevents naming collisions between types from different vendors, standards bodies, or projects.

**Response: array of `Namespace`**

```json
[
  { "uri": "http://winccoa.local/PumpType", "displayName": "PumpType" },
  { "uri": "http://winccoa.local/MotorType", "displayName": "MotorType" }
]
```

| Field | Type | Description |
|---|---|---|
| `uri` | string | Globally unique URI identifying this namespace |
| `displayName` | string | Human-readable name |

**WinCC OA mapping:**
- Source: `winccoa.dpTypes()` — returns all non-internal DP type names (skip names starting with `_`)
- One namespace entry per DP type
- `uri` is derived from the DP type name: `http://winccoa.local/<DpTypeName>`
- `displayName` is the DP type name
- The namespace does **NOT** list its members — it is just a scope identifier
- The `/namespaces` endpoint only returns the namespace entries (uri + displayName), nothing else

**Note:** The `I3X_Namespaces` CNS view is **not used**. Namespaces are derived directly from DP types.

---

## 2. Object Types — `GET /objecttypes`

Object types describe the **structure** of objects. In WinCC OA, these are **DP types**.
One entry per DP type. Individual DP instances are **not** object types.

**Response: array of `ObjectType`**

```json
[
  {
    "elementId": "PumpType",
    "displayName": "PumpType",
    "namespaceUri": "http://winccoa.local/PumpType",
    "schema": {
      "type": "object",
      "properties": {
        "alert": {
          "type": "object",
          "properties": {
            "controlFuse": { "type": "boolean", "description": "Bool" },
            "sumalert":    { "type": "boolean", "description": "Bool" }
          }
        },
        "state": {
          "type": "object",
          "properties": {
            "on": { "type": "boolean", "description": "Bool" }
          }
        }
      }
    }
  }
]
```

| Field | Type | Description |
|---|---|---|
| `elementId` | string | Unique ID — use the DP type name (e.g. `"PumpType"`) |
| `displayName` | string | Same as the DP type name |
| `namespaceUri` | string | Namespace this type belongs to — `http://winccoa.local/<DpTypeName>` |
| `schema` | object | JSON Schema describing the type's structure (recursive for nested structs) |

**WinCC OA mapping:**
- Source: `winccoa.dpTypes()` — returns all non-internal DP type names (skip names starting with `_`)
- Structure: `winccoa.dpTypeGet(typeName, true)` — returns the full type tree
- JSON Schema conversion:
  - `WinccoaElementType.Struct` → `{ "type": "object", "properties": { ... } }`
  - `Float` / `FloatStruct` → `{ "type": "number", "description": "Float" }`
  - `Bool` / `BoolStruct` → `{ "type": "boolean", "description": "Bool" }`
  - `Int` / `IntStruct` → `{ "type": "integer", "description": "Int" }`
  - etc.

---

## 3. Objects — `GET /objects`

Objects are **instances** of DP types. The object tree is the running equipment hierarchy.
The hierarchy is expressed via the `parentId` field — this is a flat list, not nested JSON.

**Response: array of `ObjectInstance`**

```json
[
  {
    "elementId": "pump1",
    "displayName": "pump1",
    "typeId": "PumpType",
    "parentId": "/",
    "isComposition": true,
    "namespaceUri": "http://winccoa.local/PumpType"
  },
  {
    "elementId": "pump1/alert",
    "displayName": "alert",
    "typeId": "object",
    "parentId": "pump1",
    "isComposition": true,
    "namespaceUri": "http://winccoa.local/PumpType"
  },
  {
    "elementId": "pump1/alert/controlFuse",
    "displayName": "controlFuse",
    "typeId": "Bool",
    "parentId": "pump1/alert",
    "isComposition": false,
    "namespaceUri": "http://winccoa.local/PumpType"
  }
]
```

| Field | Type | Description |
|---|---|---|
| `elementId` | string | Unique ID within this server |
| `displayName` | string | Human-readable name |
| `typeId` | string | References an `ObjectType.elementId` |
| `parentId` | string or null | `"/"` for root objects; otherwise the parent's `elementId` |
| `isComposition` | boolean | `true` if this object contains child components |
| `namespaceUri` | string | Namespace this object belongs to — matches the DP type's namespace URI |

**Three-level structure for WinCC OA:**

```
Level 1 — DP instance (one per DP linked in I3X_Hierarchy)
  parentId = "/"
  typeId   = DP type name (e.g. "PumpType")
  elementId = DP name (e.g. "pump1")
  namespaceUri = "http://winccoa.local/PumpType"

  Level 2 — Struct sub-elements from the DP type (only if type has nested Struct elements)
    parentId = DP elementId (e.g. "pump1")
    typeId   = "object"
    elementId = "pump1/alert"

    Level 3 — Leaf data elements
      parentId = struct node elementId (e.g. "pump1/alert")
      typeId   = element type name (e.g. "Bool", "Float")
      elementId = "pump1/alert/controlFuse"

  For FLAT types (no nested structs), Level 2 and 3 collapse:
    Level 2 — Leaf data elements directly under DP
      parentId = DP elementId
      typeId   = element type name
      elementId = "pump1/speed"
```

**WinCC OA source:**
- Which DPs to include: CNS view `I3X_Hierarchy` — only CNS leaf nodes that link to a DP, a DP element, or a DP node
- DP type structure: `winccoa.dpTypeGet(typeName, true)` — walk children recursively
- A node with `WinccoaElementType.Struct` AND non-empty children → Level 2 struct node
- A node with any other type → Level 3 leaf element (dpeName = `"dpName.element.path"`)

**`parentId` convention (from spec):**
- Root objects: `parentId = "/"` — this is the spec's explicit root sentinel
- Non-root objects: `parentId = elementId of the parent object`
- `null` means parent is unknown (avoid this)

**`isComposition` convention:**
- `true`: object has children via `HasComponent` (its children are part of its definition)
- `false`: leaf object (no children) or `HasChildren`-style container

---

## 4. Hierarchy

The `I3X_Hierarchy` CNS view defines the parent-child tree that gives context to every object. It mirrors the physical and logical organization of a plant (enterprise → site → area → line → equipment → sensor).

**CNS node types in `I3X_Hierarchy`:**

| Node type | Description | Expansion |
|---|---|---|
| **Intermediate node** | Pure organizational folder (no DP link) | Listed as a container object in the hierarchy |
| **Leaf → DP** | Links to a full DP instance | Expand to all struct nodes and leaf elements of that DP |
| **Leaf → DP node (Struct)** | Links to a struct sub-node of a DP | Expand to all leaf elements under that struct node |
| **Leaf → DP element (leaf)** | Links to a single leaf element of a DP | No further expansion needed — already a leaf |

**Rule:** Whenever a CNS leaf points to a DP or a DP struct node (anything that is not itself a primitive leaf element), **expand it** recursively until all primitive leaf elements are reached.

**Relationship types used:**

| elementId | reverseOf | Meaning |
|---|---|---|
| `HasParent` | `HasChildren` | Organizational hierarchy parent |
| `HasChildren` | `HasParent` | Organizational hierarchy children |
| `HasComponent` | `ComponentOf` | Composition — children are part of the object |
| `ComponentOf` | `HasComponent` | Inverse of HasComponent |

- Between CNS hierarchy nodes → `HasChildren` / `HasParent`
- Between a DP instance (Level 1) and its struct/leaf children → `HasComponent` / `ComponentOf`

**`POST /objects/related` request:**
```json
{
  "elementIds": ["pump1"],
  "relationshiptype": "HasChildren",
  "includeMetadata": false
}
```

---

## 5. Summary: What Belongs Where

| Endpoint | Contains | Does NOT contain |
|---|---|---|
| `/namespaces` | One URI + display name per **DP type** | Types, instances, structure |
| `/objecttypes` | One entry per **DP type** (PumpType, MotorType…) | DP instances, primitive type entries (Bool, Float…) |
| `/objects` | All DPs from `I3X_Hierarchy` + their struct nodes + leaf elements | Type definitions |

**Filtering:**
- `GET /objects?parentId=/` → returns all Level-1 DP instances (roots from `I3X_Hierarchy`)
- `GET /objects?parentId=pump1` → returns Level-2 children of pump1
- `GET /objecttypes?namespaceUri=http://winccoa.local/PumpType` → types in that namespace
