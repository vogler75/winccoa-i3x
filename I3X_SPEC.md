# i3X v1 API - WinCC OA Mapping Reference

Source: local `spec/` directory, especially `spec/IMPLEMENTATION_GUIDE.md` and
`spec/UNDERSTANDING_RELATIONSHIPS.md`.

This document is the project-specific v1 mapping reference for the WinCC OA i3X
server. The public API is mounted under `/i3x/v1`.

---

## v1 Response Envelope

All normal endpoint responses use one of these shapes:

```json
{ "success": true, "result": {} }
```

```json
{
  "success": true,
  "results": [
    { "success": true, "elementId": "Plant1/Area1/Motor1", "result": {} },
    { "success": false, "elementId": "missing", "error": { "code": 404, "message": "Object not found" } }
  ]
}
```

```json
{ "success": false, "error": { "code": 400, "message": "Validation error" } }
```

The v1 spec says bulk endpoints preserve request order, return one item per
requested ID, and set top-level `success` to `false` if any item failed.

---

## Server Info - `GET /info`

`GET /info` is unauthenticated and lets clients discover the implemented i3X
version and optional capabilities.

```json
{
  "success": true,
  "result": {
    "specVersion": "1.0-beta",
    "serverVersion": "0.1.0",
    "serverName": "winccoa-i3x",
    "capabilities": {
      "query": { "history": true },
      "update": { "current": true, "history": true },
      "subscribe": { "stream": true }
    }
  }
}
```

---

## Address Space Concepts

| i3X concept | v1 meaning | WinCC OA mapping |
| --- | --- | --- |
| Namespace | Logical grouping for ObjectTypes and RelationshipTypes | One system-level namespace for the WinCC OA system |
| ObjectType | JSON Schema describing an Object value | WinCC OA DP type from `dpTypes()` / `dpTypeGet()` |
| Object | Instance with readable/writable value | CNS node linked to a DP/DPE, or a folder node |
| RelationshipType | Bidirectional edge type | Built-in hierarchy and composition relationships |

Important v1 field names:

| v0/stale field | v1 field |
| --- | --- |
| `typeId` | `typeElementId` |
| instance-level `namespaceUri` | `metadata.typeNamespaceUri` when `includeMetadata=true` |
| root sentinel `"/"` | `parentId: null` and `GET /objects?root=true` |
| `relationshiptype` | `relationshipType` |

Element IDs are bare strings, not `obj:`, `type:`, or `rel:` prefixed IDs.

---

## Namespaces - `GET /namespaces`

A Namespace groups type definitions. In v1, Object instances do not directly
belong to a namespace; their type provenance is exposed on the Object metadata.

The current implementation returns one namespace for the WinCC OA system:

```json
{
  "success": true,
  "result": [
    { "uri": "http://winccoa.local/System1", "displayName": "System1" }
  ]
}
```

WinCC OA mapping:

- Source: `winccoa.getSystemName()`
- URI: `http://winccoa.local/<systemName>`
- `I3X_Namespaces` is currently not used for namespace discovery
- `config.cns.namespaceView` remains a configuration placeholder

---

## Object Types

### `GET /objecttypes`

Returns all ObjectTypes, optionally filtered by `namespaceUri`.

```json
{
  "success": true,
  "result": [
    {
      "elementId": "MotorType",
      "displayName": "MotorType",
      "namespaceUri": "http://winccoa.local/System1",
      "sourceTypeId": "MotorType",
      "schema": {
        "type": "object",
        "properties": {
          "speed": { "type": "number", "description": "Float" },
          "enabled": { "type": "boolean", "description": "Bool" }
        }
      }
    }
  ]
}
```

Fields:

| Field | Required | WinCC OA mapping |
| --- | --- | --- |
| `elementId` | yes | DP type name, e.g. `MotorType` |
| `displayName` | yes | DP type name |
| `namespaceUri` | yes | system namespace URI |
| `sourceTypeId` | yes | DP type name |
| `version` | no | not currently emitted |
| `schema` | yes | JSON Schema converted from `dpTypeGet(typeName, true)` |

The server also exposes a synthetic `FolderType` for CNS organizational nodes.

### `POST /objecttypes/query`

Request:

```json
{ "elementIds": ["MotorType", "FolderType"] }
```

Response is a bulk envelope with ObjectType results or per-item 404 errors.

---

## Relationship Types

### `GET /relationshiptypes`

Returns built-in bidirectional relationship type definitions. Supports optional
`namespaceUri` filtering.

```json
{
  "success": true,
  "result": [
    {
      "elementId": "HasParent",
      "displayName": "HasParent",
      "namespaceUri": "http://i3x.dev/base",
      "relationshipId": "HasParent",
      "reverseOf": "HasChildren"
    },
    {
      "elementId": "HasChildren",
      "displayName": "HasChildren",
      "namespaceUri": "http://i3x.dev/base",
      "relationshipId": "HasChildren",
      "reverseOf": "HasParent"
    },
    {
      "elementId": "HasComponent",
      "displayName": "HasComponent",
      "namespaceUri": "http://i3x.dev/base",
      "relationshipId": "HasComponent",
      "reverseOf": "ComponentOf"
    },
    {
      "elementId": "ComponentOf",
      "displayName": "ComponentOf",
      "namespaceUri": "http://i3x.dev/base",
      "relationshipId": "ComponentOf",
      "reverseOf": "HasComponent"
    }
  ]
}
```

### `POST /relationshiptypes/query`

Request:

```json
{ "elementIds": ["HasParent", "HasChildren"] }
```

Response is a bulk envelope with RelationshipType results or per-item 404
errors.

Relationship semantics:

- `HasParent` / `HasChildren` model the organizational hierarchy.
- `HasComponent` / `ComponentOf` model composition, where children are part of
  a parent object's value or structure.
- Every relationship type must have a registered reverse relationship.

---

## Objects

Objects are address-space instances. The v1 Object shape is:

```json
{
  "elementId": "Plant1/Area1/Motor1",
  "displayName": "Motor1",
  "typeElementId": "MotorType",
  "parentId": "Plant1/Area1",
  "isComposition": false,
  "isExtended": false
}
```

With `includeMetadata=true`, the server adds:

```json
{
  "metadata": {
    "typeNamespaceUri": "http://winccoa.local/System1",
    "sourceTypeId": "MotorType",
    "description": null,
    "relationships": null,
    "extendedAttributes": null,
    "system": null
  }
}
```

### WinCC OA Object Mapping

Preferred source: CNS views from `config.cns.hierarchyViews`, default
`["I3X_Hierarchy"]`.

Modelled after OPC UA's browsable address space (each nested node is its own
first-class entity). Every level of a DP's type tree surfaces as an
ObjectInstance so clients can read, subscribe, and navigate any sub-element
directly:

| DP type node | ObjectInstance fields |
| --- | --- |
| DP root (struct)          | `isComposition=true`, `typeElementId=<DpType>`, `parentId=<folder \| null>` |
| DP root (primitive/scalar)| `isComposition=false`, `typeElementId=<DpType>`, value comes from `dpName.` |
| Struct sub-node (inline)  | `isComposition=true`, `typeElementId="object"` |
| Struct sub-node (typeref) | `isComposition=true`, `typeElementId=<referenced DpType>` |
| Primitive leaf            | `isComposition=false`, `typeElementId=<primitive name>` (Float, Bool, …) |

CNS folder nodes without a DP link become `isComposition=true`,
`typeElementId="FolderType"`. CNS nodes explicitly linked to a DP sub-element
(e.g. `PUMP1.state`) become the ObjectInstance for that sub-path, and its
descendants are further expanded from there.

Synthetic ObjectTypes backing the non-user-defined `typeElementId` values
(`object`, `Float`, `Int`, `Bool`, `String`, `Time`, …, `FolderType`) are
exposed under the namespace `http://i3x.dev/base` so every `typeElementId` is
always resolvable via `/objecttypes`.

If no configured CNS hierarchy view is available, the server falls back to one
root Object per non-internal, non-primitive DP instance — plus the expanded
sub-tree below each.

Element ID convention:

| Entity | Format | Example |
| --- | --- | --- |
| ObjectType | DP type name or synthetic name | `MotorType`, `object`, `Float` |
| RelationshipType | relationship name | `HasChildren` |
| Object | slash-joined path | `Plant1/Area1/Motor1/state/on` |
| Namespace | URI | `http://winccoa.local/System1` |

### `GET /objects`

Query parameters:

| Parameter | Description |
| --- | --- |
| `typeElementId` | Return objects of a given type |
| `includeMetadata` | Include `metadata` object |
| `root=true` | Return root objects, where `parentId === null` |
| `parentId` | Project extension: return direct children of a parent |

### `POST /objects/list`

Request:

```json
{
  "elementIds": ["Plant1/Area1/Motor1"],
  "includeMetadata": false
}
```

Response is a bulk envelope with Object results or per-item 404 errors.

### `POST /objects/related`

Request:

```json
{
  "elementIds": ["Plant1/Area1"],
  "relationshipType": "HasChildren",
  "includeMetadata": false
}
```

Response:

```json
{
  "success": true,
  "results": [
    {
      "success": true,
      "elementId": "Plant1/Area1",
      "result": [
        {
          "sourceRelationship": "HasChildren",
          "object": {
            "elementId": "Plant1/Area1/Motor1",
            "displayName": "Motor1",
            "typeElementId": "MotorType",
            "parentId": "Plant1/Area1",
            "isComposition": false,
            "isExtended": false
          }
        }
      ]
    }
  ]
}
```

Supported relationship filters are `HasChildren`, `HasComponent`, `HasParent`,
and `ComponentOf`. Without a filter, direct children and the direct parent are
returned.

---

## Values

v1 value objects use VQT:

```json
{
  "value": 42,
  "quality": "Good",
  "timestamp": "2026-04-24T10:30:00.000Z"
}
```

Quality values:

| Quality | Meaning |
| --- | --- |
| `Good` | Valid value is present |
| `GoodNoData` | Source is reachable but no data exists |
| `Bad` | Value is unavailable due to an error |
| `Uncertain` | Value exists but reliability is questionable |

WinCC OA current-value mapping:

- Value source: `_online.._value`
- Timestamp source: `_online.._stime`
- Invalid flag source: `_online.._invalid`
- Primitive leaf ObjectInstance → scalar VQT
- Scalar DP root uses a trailing-dot DPE address, e.g. `ExampleDP.`
- Composition ObjectInstance (struct / folder / DP struct-root) →
  `value: null, quality: "GoodNoData"`. When `maxDepth > 1`, `components`
  is populated with the immediate child ObjectInstances' VQTs, keyed by
  child elementId. Clients drill further by passing a child's elementId.

### `POST /objects/value`

Request:

```json
{ "elementIds": ["Plant1/Area1/Motor1"], "maxDepth": 2 }
```

Response for a struct root:

```json
{
  "success": true,
  "results": [
    {
      "success": true,
      "elementId": "Plant1/Area1/Motor1",
      "result": {
        "isComposition": true,
        "value": null,
        "quality": "GoodNoData",
        "timestamp": "2026-04-24T10:30:00.000Z",
        "components": {
          "Plant1/Area1/Motor1/state": {
            "isComposition": true, "value": null, "quality": "GoodNoData",
            "timestamp": "2026-04-24T10:30:00.000Z"
          },
          "Plant1/Area1/Motor1/speed": {
            "isComposition": false, "value": 1500, "quality": "Good",
            "timestamp": "2026-04-24T10:30:00.000Z"
          }
        }
      }
    }
  ]
}
```

For a primitive leaf the result is just `{ isComposition: false, value, quality, timestamp }`.

`maxDepth` semantics:

- `1` — no recursion; compositions return no `components`
- `N > 1` — include up to N-1 levels of child `components`
- `0` — unlimited depth

### `PUT /objects/{elementId}/value`

Writes a current value. The current implementation accepts the raw JSON value
as the request body:

```json
42
```

Only Objects that resolve to exactly one primitive DPE are writable. Struct
roots and folders are not writable as a whole.

Spec note: the v1 guide describes a VQT request body with `value`, optional
`quality`, and optional `timestamp`. This project currently writes the raw value
and ignores client-supplied quality/timestamp for current writes.

---

## History

WinCC OA history source: `_offline.._value` via `dpGetPeriod`.

### `POST /objects/history`

Request:

```json
{
  "elementIds": ["Plant1/Area1/Motor1/speed"],
  "startTime": "2026-04-24T00:00:00.000Z",
  "endTime": "2026-04-24T12:00:00.000Z",
  "maxDepth": 1,
  "maxValues": 1000
}
```

Response:

```json
{
  "success": true,
  "results": [
    {
      "success": true,
      "elementId": "Plant1/Area1/Motor1/speed",
      "result": {
        "isComposition": false,
        "values": [
          { "value": 1500, "quality": "Good", "timestamp": "2026-04-24T10:00:00.000Z" }
        ]
      }
    }
  ]
}
```

Struct Objects are expanded into one bulk result per primitive leaf, using
synthetic result IDs such as `Plant1/Area1/Motor1/state/running`.

### `GET /objects/{elementId}/history`

Project extension for reading one element's history. Query parameters:
`startTime`, `endTime`, and optional `maxValues`.

### `PUT /objects/{elementId}/history`

Project extension for historical writes. Request body:

```json
{
  "data": [
    { "value": 1500, "timestamp": "2026-04-24T10:00:00.000Z" }
  ]
}
```

Only Objects that resolve to one primitive DPE are writable. Values are written
with `dpSetTimedWait`.

---

## Subscriptions

Subscriptions are in memory and are lost when the JavaScript Manager restarts.
They monitor WinCC OA values with `dpConnect`.

The v1 spec requires `clientId` to scope subscriptions. This implementation
accepts and returns `clientId`, but currently does not require it.

### `POST /subscriptions`

Request:

```json
{ "clientId": "client-a", "displayName": "main-stream" }
```

Response:

```json
{
  "success": true,
  "result": {
    "clientId": "client-a",
    "subscriptionId": "sub-123",
    "displayName": "main-stream"
  }
}
```

### `POST /subscriptions/register`

Request:

```json
{
  "clientId": "client-a",
  "subscriptionId": "sub-123",
  "elementIds": ["Plant1/Area1/Motor1/speed"],
  "maxDepth": 1
}
```

Registers values to monitor. Duplicate registrations return success.

### `POST /subscriptions/unregister`

Request:

```json
{
  "clientId": "client-a",
  "subscriptionId": "sub-123",
  "elementIds": ["Plant1/Area1/Motor1/speed"]
}
```

Stops monitoring the listed IDs for future updates.

### `POST /subscriptions/stream`

Opens a Server-Sent Events stream:

```json
{
  "clientId": "client-a",
  "subscriptionId": "sub-123"
}
```

SSE update payloads are VQT-like updates:

```json
{
  "sequenceNumber": 1,
  "elementId": "Plant1/Area1/Motor1/speed",
  "value": 1500,
  "quality": "Good",
  "timestamp": "2026-04-24T10:30:00.000Z"
}
```

### `POST /subscriptions/sync`

Polls queued updates and optionally acknowledges prior updates:

```json
{
  "clientId": "client-a",
  "subscriptionId": "sub-123",
  "lastSequenceNumber": 1
}
```

If `lastSequenceNumber` is provided, the server removes all queued updates with
sequence numbers less than or equal to it before returning the remaining queue.

### `POST /subscriptions/list`

Bulk fetch subscription details:

```json
{
  "clientId": "client-a",
  "subscriptionIds": ["sub-123"]
}
```

### `POST /subscriptions/delete`

Bulk delete subscriptions:

```json
{
  "clientId": "client-a",
  "subscriptionIds": ["sub-123"]
}
```

---

## Implementation Notes

- This project is plain JavaScript/CommonJS; no TypeScript build step exists.
- WinCC OA API calls must stay inside functions, except creating
  `new WinccoaManager()`.
- Simple datapoints require trailing-dot DPE addresses when accessed directly,
  e.g. `ExampleDP.`.
- Internal WinCC OA types and datapoints beginning with `_` are skipped.
- Primitive DP type instances are skipped in fallback enumeration to avoid
  flooding `/objects`.
- The hierarchy cache is rebuilt on demand and invalidated by system/CNS events.
- Use `winccoa-nodejs.md` for exact WinCC OA API behavior.

Current v1 alignment gaps to track:

- Bulk envelopes currently use top-level `success: true` even when an item in
  `results` failed.
- Subscription `clientId` is accepted and returned but not required or enforced.
- Current-value writes accept a raw JSON value instead of the v1 VQT body.
