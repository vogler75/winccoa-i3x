# WinCC OA i3X Server - Implementation Plan

## Context

CESMII's **i3X (Industrial Information Interoperability eXchange)** is an open, vendor-neutral REST API specification for standardized access to contextualized manufacturing data. We are building an i3X server that runs as a **WinCC OA JavaScript Manager**, exposing WinCC OA datapoints, types, and historical data through the i3X REST API. This enables any i3X-compatible client (analytics, visualization, ML/AI apps) to interoperate with WinCC OA.

**Key decisions made:**
- Each WinCC OA DP element becomes its own i3X ObjectInstance (granular addressing)
- Express.js for HTTP server
- Basic Auth mapped to WinCC OA user management
- CNS trees for namespace and hierarchy definitions

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  WinCC OA JavaScript Manager (Node.js)          │
│                                                 │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │  Express.js   │  │  WinCC OA API          │  │
│  │  HTTP Server  │  │  (winccoa-manager)     │  │
│  │               │  │                        │  │
│  │  /i3x/v0/     │  │  - dpGet/dpSet         │  │
│  │  REST API     │←→│  - dpConnect           │  │
│  │  + SSE        │  │  - dpGetPeriod         │  │
│  │               │  │  - dpTypes/dpNames     │  │
│  └───────────────┘  │  - dpTypeGet           │  │
│         ↑           │  - CNS API             │  │
│         │           └────────────────────────┘  │
│    HTTP/HTTPS                                   │
└─────────────────────────────────────────────────┘
         ↑
    i3X Clients
    (I3X Explorer, custom apps, analytics)
```

---

## 1. Project Setup

**Directory:** `/media/psf/Workspace/winccoa-i3x/`

### 1.1 File Structure
```
winccoa-i3x/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # Manager entry point
│   ├── config.ts                 # Server configuration
│   ├── server.ts                 # Express server setup
│   ├── auth.ts                   # Basic Auth middleware
│   ├── mapping/
│   │   ├── namespaces.ts         # CNS → i3X Namespace mapping
│   │   ├── object-types.ts       # DP Types → i3X ObjectType mapping
│   │   ├── object-instances.ts   # DPs/DPEs → i3X ObjectInstance mapping
│   │   ├── relationships.ts      # Relationship type definitions
│   │   ├── values.ts             # VQT value read/write + quality mapping
│   │   └── hierarchy.ts          # CNS hierarchy → parent/child mapping
│   ├── routes/
│   │   ├── namespaces.ts         # GET /namespaces
│   │   ├── object-types.ts       # GET/POST /objecttypes
│   │   ├── relationship-types.ts # GET/POST /relationshiptypes
│   │   ├── objects.ts            # GET/POST /objects, /objects/list, /objects/related
│   │   ├── values.ts             # POST /objects/value, PUT /objects/:id/value
│   │   ├── history.ts            # POST /objects/history, PUT /objects/:id/history
│   │   └── subscriptions.ts      # Full subscription CRUD + SSE stream
│   ├── subscriptions/
│   │   ├── manager.ts            # Subscription lifecycle management
│   │   ├── sse.ts                # SSE stream handling
│   │   └── monitor.ts            # dpConnect-based monitoring
│   └── utils/
│       ├── element-id.ts         # ElementId encoding/decoding
│       ├── json-schema.ts        # DP type → JSON Schema conversion
│       ├── quality.ts            # WinCC OA status → i3X quality mapping
│       └── errors.ts             # Error response formatting
```

### 1.2 Dependencies

```json
{
  "name": "winccoa-i3x",
  "version": "0.1.0",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w"
  },
  "dependencies": {
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.18.1",
    "@types/express": "^5.0.0",
    "@types/cors": "^2.8.17",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.9.2"
  }
}
```

Plus: `npm install --save-dev /opt/WinCC_OA/3.21/javascript/@types/winccoa-manager`

---

## 2. CNS Configuration Design

### 2.1 Namespace CNS View: `I3X_Namespaces`

One CNS view with one tree. Each child node under the root represents a namespace. Under each namespace node, child nodes reference DP types belonging to that namespace.

```
I3X_Namespaces (view)
└── Root (tree root)
    ├── CESMII_Base (node)
    │   │  property "uri" = "http://cesmii.org/base"
    │   │  displayName = "CESMII Base Types"
    │   ├── FloatType (node, data = "")      ← base element types
    │   ├── IntType (node, data = "")
    │   ├── BoolType (node, data = "")
    │   └── StringType (node, data = "")
    │
    └── MyPlant (node)
        │  property "uri" = "http://mycompany.com/plant1"
        │  displayName = "My Plant Types"
        ├── MotorType (node, data = "MotorType")  ← links to WinCC OA DP type
        └── SensorType (node, data = "SensorType")
```

**CNS Node Properties used:**
- `uri` (string) — the namespace URI (stored via `cnsSetProperty`)
- CNS `displayName` — the namespace display name
- CNS `data` — the WinCC OA DP type name (for type nodes)

### 2.2 Hierarchy CNS View: `I3X_Hierarchy`

One CNS view with one tree. The tree structure defines the equipment hierarchy. Each node can optionally reference a WinCC OA DP via CNS `data`.

```
I3X_Hierarchy (view)
└── Root (tree root)
    ├── Plant1 (node, data = "")           ← organizational folder, no DP
    │   ├── Area1 (node, data = "")
    │   │   ├── Motor1 (node, data = "Motor1")    ← links to DP
    │   │   │   ├── speed (auto-generated)         ← from DP type structure
    │   │   │   ├── temp (auto-generated)
    │   │   │   └── enabled (auto-generated)
    │   │   └── Motor2 (node, data = "Motor2")
    │   └── Area2 (node, data = "")
    │       └── Sensor1 (node, data = "Sensor1")
    └── Plant2 (node, data = "")
        └── ...
```

**Key rules:**
- Nodes with `data = ""` (empty) are organizational folders → ObjectType = "FolderType"
- Nodes with `data = "SomeDPName"` reference a WinCC OA DP → ObjectType = that DP's type
- DP element children are auto-generated from the DP type structure (not manually created in CNS)
- The hierarchy CNS tree defines parent-child relationships for i3X

### 2.3 Namespace Resolution for Instances

When a CNS hierarchy node references a DP, the DP's type is looked up in the namespace CNS tree to determine its `namespaceUri`. Organizational folders inherit the namespace of their closest ancestor with a known namespace, or use a default project namespace.

---

## 3. Data Model Mapping

### 3.1 ElementId Convention

Every i3X entity needs a unique `elementId`. Our convention:

| i3X Entity | ElementId Format | Example |
|-----------|-----------------|---------|
| Namespace | `ns:{uri}` | `ns:http://mycompany.com/plant1` |
| ObjectType (DP type) | `type:{dpTypeName}` | `type:MotorType` |
| ObjectType (element) | `type:{elementTypeName}` | `type:Float` |
| ObjectType (folder) | `type:FolderType` | `type:FolderType` |
| ObjectInstance (DP) | `obj:{cnsPath}` | `obj:Plant1/Area1/Motor1` |
| ObjectInstance (DPE) | `obj:{cnsPath}/{element}` | `obj:Plant1/Area1/Motor1/speed` |
| ObjectInstance (folder) | `obj:{cnsPath}` | `obj:Plant1/Area1` |
| RelationshipType | `rel:{name}` | `rel:HasParent` |

Using CNS paths as the base for object elementIds provides stable, hierarchical identifiers.

### 3.2 ObjectType Mapping (DP Type → i3X)

```ts
// WinCC OA DP Type "MotorType" with structure:
//   speed: Float
//   temp: Float
//   config: Struct
//     maxSpeed: Float
//     enabled: Bool

// Maps to i3X ObjectType:
{
  elementId: "type:MotorType",
  displayName: "MotorType",
  namespaceUri: "http://mycompany.com/plant1",
  schema: {
    type: "object",
    properties: {
      speed: { type: "number", description: "Float" },
      temp: { type: "number", description: "Float" },
      config: {
        type: "object",
        properties: {
          maxSpeed: { type: "number", description: "Float" },
          enabled: { type: "boolean", description: "Bool" }
        }
      }
    }
  }
}
```

**Conversion logic** (`json-schema.ts`): Use `winccoa.dpTypeGet(typeName, true)` to get the `WinccoaDpTypeNode` tree, then recursively convert to JSON Schema:

| WinCC OA ElementType | JSON Schema type |
|---------------------|-----------------|
| Float, Long, ULong | `number` |
| Int, UInt | `integer` |
| Bool | `boolean` |
| String, LangString, Char | `string` |
| Time | `string` (format: date-time) |
| Blob | `string` (format: base64) |
| Bit32, Bit64 | `integer` |
| Struct | `object` (with nested properties) |
| Dyn* | `array` (with items type) |

### 3.3 ObjectInstance Mapping

**For DP-backed nodes:**
```ts
{
  elementId: "obj:Plant1/Area1/Motor1",
  displayName: "Motor1",
  typeId: "type:MotorType",
  parentId: "obj:Plant1/Area1",
  isComposition: true,  // has DPE children
  namespaceUri: "http://mycompany.com/plant1"
}
```

**For DPE children (auto-generated):**
```ts
{
  elementId: "obj:Plant1/Area1/Motor1/speed",
  displayName: "speed",
  typeId: "type:Float",
  parentId: "obj:Plant1/Area1/Motor1",
  isComposition: false,  // leaf element
  namespaceUri: "http://mycompany.com/plant1"
}
```

**For organizational folders:**
```ts
{
  elementId: "obj:Plant1/Area1",
  displayName: "Area1",
  typeId: "type:FolderType",
  parentId: "obj:Plant1",
  isComposition: true,
  namespaceUri: "http://mycompany.com/plant1"
}
```

### 3.4 Value (VQT) Mapping

For leaf DPE objects, the value is read via `dpGet`:

```ts
// WinCC OA reads:
const value = await winccoa.dpGet('Motor1.speed');
const [val, stime, status] = await winccoa.dpGet([
  'Motor1.speed:_original.._value',
  'Motor1.speed:_original.._stime',
  'Motor1.speed:_online.._invalid'
]);

// Maps to i3X VQT:
{
  value: 100.5,
  quality: "Good",        // mapped from _online.._invalid
  timestamp: "2026-03-03T10:30:00.000Z"  // from _original.._stime
}
```

**Quality mapping** (`quality.ts`):

| WinCC OA Condition | i3X Quality |
|--------------------|-------------|
| `_online.._invalid` = false | `"Good"` |
| `_online.._invalid` = true | `"Bad"` |
| No value exists | `"GoodNoData"` |
| DP not connected to driver | `"NotConnected"` |
| Value older than threshold | `"Stale"` |

### 3.5 RelationshipTypes

Built-in relationship types (always present):

```ts
[
  { elementId: "rel:HasParent",    displayName: "HasParent",    namespaceUri: "http://i3x.dev/base", reverseOf: "HasChildren" },
  { elementId: "rel:HasChildren",  displayName: "HasChildren",  namespaceUri: "http://i3x.dev/base", reverseOf: "HasParent" },
  { elementId: "rel:HasComponent", displayName: "HasComponent", namespaceUri: "http://i3x.dev/base", reverseOf: "ComponentOf" },
  { elementId: "rel:ComponentOf",  displayName: "ComponentOf",  namespaceUri: "http://i3x.dev/base", reverseOf: "HasComponent" }
]
```

- `HasParent/HasChildren` — derived from CNS hierarchy tree structure
- `HasComponent/ComponentOf` — DP to DPE relationship (DP "has component" DPE)

---

## 4. API Endpoints Implementation

Base URL: `/i3x/v0/`

### 4.1 Exploration Endpoints

| # | Method | Path | WinCC OA Source | Description |
|---|--------|------|----------------|-------------|
| 1 | `GET` | `/namespaces` | CNS `I3X_Namespaces` tree children + properties | List all namespaces |
| 2 | `GET` | `/objecttypes` | `dpTypes()` + CNS namespace lookup | List all object types, optional `?namespaceUri=` filter |
| 3 | `POST` | `/objecttypes/query` | `dpTypeGet()` for each requested type | Get types by elementId array |
| 4 | `GET` | `/relationshiptypes` | Static list + optional `?namespaceUri=` filter | List relationship types |
| 5 | `POST` | `/relationshiptypes/query` | Filter static list by elementId array | Get specific relationship types |
| 6 | `GET` | `/objects` | CNS hierarchy traversal + `dpNames()` | List all objects, optional `?typeId=` and `?includeMetadata=` |
| 7 | `POST` | `/objects/list` | CNS + `dpExists()` per elementId | Get objects by elementId array |
| 8 | `POST` | `/objects/related` | CNS parent/children lookup | Get related objects by elementId + relationship type |

### 4.2 Value Endpoints

| # | Method | Path | WinCC OA Source | Description |
|---|--------|------|----------------|-------------|
| 9 | `POST` | `/objects/value` | `dpGet()` with `_original.._value`, `_original.._stime`, `_online.._invalid` | Get last known values for elementIds, with `maxDepth` |
| 10 | `PUT` | `/objects/:elementId/value` | `dpSetWait()` | Write a value to a DPE |

### 4.3 History Endpoints

| # | Method | Path | WinCC OA Source | Description |
|---|--------|------|----------------|-------------|
| 11 | `POST` | `/objects/history` | `dpGetPeriod()` | Get historical values with `startTime`, `endTime`, `maxDepth` |
| 12 | `PUT` | `/objects/:elementId/history` | `dpSetTimedWait()` (insert historical values) | Write historical values |

### 4.4 Subscription Endpoints

| # | Method | Path | WinCC OA Source | Description |
|---|--------|------|----------------|-------------|
| 13 | `GET` | `/subscriptions` | In-memory subscription store | List all subscriptions |
| 14 | `POST` | `/subscriptions` | Create subscription entry | Create new subscription |
| 15 | `GET` | `/subscriptions/:id` | Subscription store lookup | Get subscription details |
| 16 | `DELETE` | `/subscriptions/:id` | `dpDisconnect()` + cleanup | Delete subscription |
| 17 | `POST` | `/subscriptions/:id/register` | `dpConnect()` per DPE | Add monitored items |
| 18 | `POST` | `/subscriptions/:id/unregister` | `dpDisconnect()` per DPE | Remove monitored items |
| 19 | `GET` | `/subscriptions/:id/stream` | SSE response, fed by dpConnect callbacks | SSE event stream |
| 20 | `POST` | `/subscriptions/:id/sync` | Return + clear queued updates | Poll-based sync |

---

## 5. Subscription System Design

### 5.1 Architecture

```
Client A ──SSE──→ Subscription #1 ──→ dpConnect(Motor1.speed)
                                  ──→ dpConnect(Motor1.temp)

Client B ──sync──→ Subscription #2 ──→ dpConnect(Sensor1.value)
```

### 5.2 Subscription Manager (`subscriptions/manager.ts`)

```ts
interface Subscription {
  id: string;
  created: Date;
  monitoredItems: Map<string, {    // elementId → monitoring state
    dpeName: string;               // WinCC OA DPE name
    connectId: number;             // dpConnect return ID
    maxDepth: number;
  }>;
  valueQueue: SyncResponseItem[]; // queued updates for sync
  sseClients: Set<Response>;      // active SSE connections
}
```

- On `register`: resolve elementId → DPE name, call `winccoa.dpConnect()`, store connectId
- On value change callback: push VQT to `valueQueue` AND write to all SSE clients
- On `unregister`: call `winccoa.dpDisconnect(connectId)`
- On `delete`: disconnect all, close all SSE, remove subscription
- On `sync`: return and clear `valueQueue`
- On `stream`: set up SSE headers, add response to `sseClients`, keep connection open

### 5.3 maxDepth Handling

When `maxDepth > 1` and the target is a composition object:
- Resolve all child DPEs recursively up to maxDepth levels
- Subscribe to each resolved DPE individually
- Group updates by parent elementId in the response

### 5.4 SSE Format

```
data: [{"obj:Plant1/Area1/Motor1/speed":{"data":[{"value":100.5,"quality":"Good","timestamp":"2026-03-03T10:30:00Z"}]}}]

data: [{"obj:Plant1/Area1/Motor1/temp":{"data":[{"value":52.3,"quality":"Good","timestamp":"2026-03-03T10:30:01Z"}]}}]
```

---

## 6. Authentication (`auth.ts`)

### 6.1 Basic Auth Middleware

```ts
// Express middleware that:
// 1. Extracts Authorization: Basic <base64> header
// 2. Decodes username:password
// 3. Calls winccoa.getUserId(username) to verify user exists
// 4. Calls winccoa.setUserId(userId, password) to validate credentials
// 5. Returns 401 if invalid, proceeds if valid
```

### 6.2 Configuration

- Auth can be disabled for development via config (`auth.enabled: false`)
- Per-endpoint auth is possible but not needed initially

---

## 7. Caching Strategy

### 7.1 What to Cache

| Data | Cache Duration | Invalidation |
|------|---------------|-------------|
| CNS namespace tree | On startup + sysConnect events | `DpTypeCreated`, `DpTypeDeleted`, CNS observer |
| CNS hierarchy tree | On startup + sysConnect events | CNS observer |
| DP type structures | On startup + sysConnect events | `DpTypeCreated`, `DpTypeChanged`, `DpTypeDeleted` |
| DP existence | On startup + sysConnect events | `DpCreated`, `DpDeleted` |
| JSON Schema per type | Derived from DP type cache | Regenerate on type change |

### 7.2 Implementation

- Build in-memory maps on startup by traversing CNS trees and DP types
- Register `winccoa.sysConnect` listeners for `DpCreated`, `DpDeleted`, `DpTypeCreated`, `DpTypeChanged`, `DpTypeDeleted`
- Register CNS observers via `winccoa.cnsAddObserver()` for hierarchy/namespace changes
- On change events, invalidate and rebuild affected cache entries

---

## 8. Configuration (`config.ts`)

```ts
interface I3XServerConfig {
  port: number;                        // default: 8443
  basePath: string;                    // default: "/i3x/v0"
  auth: {
    enabled: boolean;                  // default: true
  };
  cns: {
    namespaceView: string;             // default: "I3X_Namespaces"
    hierarchyView: string;             // default: "I3X_Hierarchy"
  };
  defaultNamespaceUri: string;         // default: "http://winccoa.local/default"
  cors: {
    enabled: boolean;                  // default: true
    origin: string;                    // default: "*"
  };
}
```

Configuration is read from a WinCC OA config section `[i3x]` via `winccoa.cfgReadContent()`, or from a `i3x-config.json` file in the project directory.

---

## 9. Error Handling

### 9.1 HTTP Error Responses

```json
{
  "error": {
    "code": 404,
    "message": "Object not found",
    "details": "No object with elementId 'obj:Plant1/Motor99'"
  }
}
```

### 9.2 Error Mapping

| Scenario | HTTP Status | i3X Error |
|----------|------------|-----------|
| Object not found | 404 | "Object not found" |
| Type not found | 404 | "Type not found" |
| Invalid elementId | 400 | "Invalid elementId format" |
| Auth missing | 401 | "Authentication required" |
| Auth invalid | 401 | "Invalid credentials" |
| WinCC OA error | 500 | Forward WinccoaError details |
| DP not writable | 403 | "Write not permitted" |
| Invalid request body | 400 | "Validation error" |
| Subscription not found | 404 | "Subscription not found" |

---

## 10. Implementation Phases

### Phase 1: Foundation ✅
1. Project setup (package.json, tsconfig.json, directory structure)
2. `config.ts` — configuration loading
3. `index.ts` — manager entry point, Express server init
4. `server.ts` — Express app setup with CORS, JSON parsing, base path routing
5. `auth.ts` — Basic Auth middleware
6. `utils/element-id.ts` — elementId encode/decode helpers
7. `utils/errors.ts` — error response formatting

### Phase 2: CNS & Type Mapping ✅
8. `mapping/namespaces.ts` — read CNS namespace view, build namespace list
9. `mapping/object-types.ts` — enumerate DP types, map to i3X ObjectTypes
10. `utils/json-schema.ts` — WinccoaDpTypeNode → JSON Schema conversion
11. `mapping/hierarchy.ts` — read CNS hierarchy view, build parent/child tree
12. `mapping/object-instances.ts` — resolve DPs/DPEs to i3X ObjectInstances
13. `mapping/relationships.ts` — built-in relationship type definitions

### Phase 3: Exploration Routes ✅
14. `routes/namespaces.ts` — GET /namespaces
15. `routes/object-types.ts` — GET /objecttypes, POST /objecttypes/query
16. `routes/relationship-types.ts` — GET /relationshiptypes, POST /relationshiptypes/query
17. `routes/objects.ts` — GET /objects, POST /objects/list, POST /objects/related

### Phase 4: Value Access ✅
18. `mapping/values.ts` — dpGet with VQT, quality mapping
19. `utils/quality.ts` — WinCC OA status → i3X quality
20. `routes/values.ts` — POST /objects/value, PUT /objects/:elementId/value

### Phase 5: Historical Data ✅
21. `routes/history.ts` — POST /objects/history, PUT /objects/:elementId/history

### Phase 6: Subscriptions ✅
22. `subscriptions/manager.ts` — subscription lifecycle, in-memory store
23. `subscriptions/monitor.ts` — dpConnect-based value monitoring
24. `subscriptions/sse.ts` — SSE stream management
25. `routes/subscriptions.ts` — full subscription CRUD + SSE + sync

### Phase 7: Caching & Events ✅
26. sysConnect listeners for DP/type creation/deletion
27. CNS observers for namespace/hierarchy changes
28. Cache invalidation and rebuild logic

### Phase 8: Polish & Testing
29. Startup logging and health check endpoint ✅
30. Graceful shutdown (registerExitCallback) ✅
31. Test with I3X Explorer client
32. Test with curl/httpie for each endpoint

---

## 11. Key Files

All files are new (greenfield project):

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `package.json` | Dependencies | 25 |
| `tsconfig.json` | TypeScript config | 15 |
| `src/index.ts` | Entry point | 40 |
| `src/config.ts` | Configuration | 60 |
| `src/server.ts` | Express setup | 50 |
| `src/auth.ts` | Auth middleware | 50 |
| `src/mapping/namespaces.ts` | Namespace mapping | 80 |
| `src/mapping/object-types.ts` | Type mapping | 120 |
| `src/mapping/object-instances.ts` | Instance mapping | 150 |
| `src/mapping/hierarchy.ts` | Hierarchy mapping | 120 |
| `src/mapping/relationships.ts` | Relationship defs | 40 |
| `src/mapping/values.ts` | Value read/write | 100 |
| `src/routes/namespaces.ts` | Namespace routes | 30 |
| `src/routes/object-types.ts` | Type routes | 60 |
| `src/routes/relationship-types.ts` | RelType routes | 50 |
| `src/routes/objects.ts` | Object routes | 120 |
| `src/routes/values.ts` | Value routes | 80 |
| `src/routes/history.ts` | History routes | 80 |
| `src/routes/subscriptions.ts` | Subscription routes | 150 |
| `src/subscriptions/manager.ts` | Subscription mgmt | 120 |
| `src/subscriptions/monitor.ts` | dpConnect monitoring | 80 |
| `src/subscriptions/sse.ts` | SSE stream handling | 60 |
| `src/utils/element-id.ts` | ElementId helpers | 50 |
| `src/utils/json-schema.ts` | Type → Schema | 80 |
| `src/utils/quality.ts` | Quality mapping | 40 |
| `src/utils/errors.ts` | Error formatting | 40 |

**Total: ~26 files, ~1,900 lines estimated**

---

## 12. Verification Plan

### 12.1 Manual Testing with curl

```bash
# Test namespaces
curl http://localhost:8443/i3x/v0/namespaces -u admin:password

# Test object types
curl http://localhost:8443/i3x/v0/objecttypes -u admin:password

# Test objects (hierarchy)
curl http://localhost:8443/i3x/v0/objects -u admin:password

# Test values
curl -X POST http://localhost:8443/i3x/v0/objects/value \
  -u admin:password -H "Content-Type: application/json" \
  -d '{"elementIds":["obj:Plant1/Area1/Motor1/speed"],"maxDepth":1}'

# Test history
curl -X POST http://localhost:8443/i3x/v0/objects/history \
  -u admin:password -H "Content-Type: application/json" \
  -d '{"elementIds":["obj:Plant1/Area1/Motor1/speed"],"startTime":"2026-03-01T00:00:00Z","endTime":"2026-03-03T23:59:59Z"}'

# Test SSE subscription
SUB=$(curl -s -X POST http://localhost:8443/i3x/v0/subscriptions -u admin:password | jq -r .subscriptionId)
curl -X POST http://localhost:8443/i3x/v0/subscriptions/$SUB/register \
  -u admin:password -H "Content-Type: application/json" \
  -d '{"elementIds":["obj:Plant1/Area1/Motor1/speed"]}'
curl -N http://localhost:8443/i3x/v0/subscriptions/$SUB/stream -u admin:password
```

### 12.2 Test with I3X Explorer

1. Build and run the WinCC OA i3X server manager
2. Open I3X Explorer
3. Connect to `http://localhost:8443/i3x/v0/` with Basic auth
4. Verify: namespace tree loads, objects browsable, values readable, subscriptions work

### 12.3 Prerequisites in WinCC OA

Before testing, the WinCC OA project needs:
- CNS views `I3X_Namespaces` and `I3X_Hierarchy` created with appropriate structure
- At least one DP type and a few DPs for testing
- A user account for Basic Auth testing
