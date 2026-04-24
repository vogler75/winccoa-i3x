# WinCC OA i3X Server

REST API server that exposes WinCC OA datapoints, datapoint types, live values, history, and subscriptions through the CESMII i3X API shape.

This project is a prototype. API behavior, mapping rules, configuration, and startup details may change in future versions.

The server runs as a WinCC OA JavaScript Manager and uses Express.js for HTTP routing. It is plain JavaScript using CommonJS modules; there is no build step.

## What It Provides

- i3X namespace discovery for the current WinCC OA system
- i3X object type discovery from WinCC OA datapoint types
- i3X object instance discovery from CNS hierarchy views, with a datapoint-enumeration fallback
- Current value reads and writes for leaf datapoint elements
- Historical value reads and writes
- In-memory subscriptions with WinCC OA `dpConnect` monitoring
- Server-Sent Events (SSE) streams and poll-based subscription sync
- Basic Auth against WinCC OA user management

## Requirements

- WinCC OA 3.21 JavaScript Manager runtime
- Node.js environment provided by WinCC OA with access to `winccoa-manager`
- npm dependencies from `package.json`
- A WinCC OA project containing datapoint types and datapoints
- Optional CNS hierarchy view, configured as `I3X_Hierarchy` by default

Install dependencies:

```bash
npm install
```

For editor type hints only, install the WinCC OA type package if it is available on the machine:

```bash
npm install --save-dev /opt/WinCC_OA/3.21/javascript/@types/winccoa-manager
```

## Run

The normal production setup is to add this server to the WinCC OA Console as a Node.js/JavaScript Manager and configure it to run:

```text
winccoa-i3x/index.js
```

It can also be started manually through the WinCC OA JavaScript Manager bootstrap. Adapt the WinCC OA version path, project name, `pmonIndex`, and script path for your installation:

```bash
node "/opt/WinCC_OA/3.21/javascript/winccoa-manager/lib/bootstrap.js" \
  -PROJ Example \
  -pmonIndex 8 \
  winccoa-i3x/index.js
```

For local syntax/runtime startup checks where `winccoa-manager` is resolvable:

```bash
npm start
```

The server listens on `0.0.0.0:8080` by default and exposes the API under:

```text
/i3x/v0
```

## Configuration

Configuration is loaded from [config.json](config.json). Missing values fall back to defaults in [config.js](config.js).

```json
{
  "host": "0.0.0.0",
  "port": 8080,
  "basePath": "/i3x/v0",
  "auth": {
    "enabled": true
  },
  "cns": {
    "namespaceView": "I3X_Namespaces",
    "hierarchyViews": ["I3X_Hierarchy"]
  },
  "defaultNamespaceUri": "http://winccoa.local/default",
  "cors": {
    "enabled": true,
    "origin": "*"
  }
}
```

Notes:

- `auth.enabled: true` validates Basic Auth credentials with WinCC OA users.
- `cns.hierarchyViews` controls which CNS views are used to build object instances.
- If no configured CNS hierarchy view is readable, the server falls back to enumerating datapoints by type.
- `namespaceView` is present for compatibility/configuration, but the current namespace mapping returns one namespace for the current WinCC OA system.

## Data Mapping

Namespaces:

- `GET /namespaces` returns a single namespace for the current WinCC OA system.
- The URI format is `http://winccoa.local/<systemName>`.

Object types:

- WinCC OA datapoint types become i3X object types.
- Internal types beginning with `_` are skipped.
- A synthetic `FolderType` is included for CNS organizational nodes.
- Type structure is converted to JSON Schema using `dpTypeGet(typeName, true)`.

Objects:

- The preferred source is the CNS hierarchy view configured in `cns.hierarchyViews`.
- CNS nodes linked to a datapoint are expanded into child objects based on the datapoint type structure.
- CNS nodes linked to a struct datapoint element are expanded below that struct node.
- CNS nodes linked to a primitive datapoint element become leaf objects.
- CNS nodes without a resolvable datapoint link become `FolderType` objects.
- Object `elementId` values are slash-separated hierarchy paths such as `Plant1/Area1/Motor1/speed`.

Values:

- Only leaf datapoint elements are readable/writable.
- Current values are read from `_online.._value`, `_online.._stime`, and `_online.._invalid`.
- History is read from `_offline.._value` using `dpGetPeriod`.

## API Endpoints

All paths below are relative to `/i3x/v0`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/namespaces` | List namespaces |
| `GET` | `/objecttypes` | List object types |
| `POST` | `/objecttypes/query` | Query object types by `elementIds` |
| `GET` | `/relationshiptypes` | List relationship types |
| `POST` | `/relationshiptypes/query` | Query relationship types by `elementIds` |
| `GET` | `/objects` | List objects; supports `typeId` and `parentId` query filters |
| `POST` | `/objects/list` | Query objects by `elementIds` |
| `POST` | `/objects/related` | Query parent/child/component relationships |
| `POST` | `/objects/value` | Read current values |
| `PUT` | `/objects/:elementId/value` | Write one current value |
| `POST` | `/objects/history` | Read historical values |
| `PUT` | `/objects/:elementId/history` | Write historical values |
| `GET` | `/subscriptions` | List subscriptions |
| `POST` | `/subscriptions` | Create subscription |
| `GET` | `/subscriptions/:id` | Get subscription metadata |
| `DELETE` | `/subscriptions/:id` | Delete subscription |
| `POST` | `/subscriptions/:id/register` | Register monitored element IDs |
| `POST` | `/subscriptions/:id/unregister` | Unregister monitored element IDs |
| `GET` | `/subscriptions/:id/stream` | Open SSE stream |
| `POST` | `/subscriptions/:id/sync` | Poll queued subscription updates |

## Examples

Use Basic Auth when `auth.enabled` is true:

```bash
curl -u admin:password http://localhost:8080/i3x/v0/health
curl -u admin:password http://localhost:8080/i3x/v0/namespaces
curl -u admin:password http://localhost:8080/i3x/v0/objecttypes
curl -u admin:password http://localhost:8080/i3x/v0/objects
```

Read current values:

```bash
curl -X POST http://localhost:8080/i3x/v0/objects/value \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"elementIds":["Plant1/Area1/Motor1/speed"],"maxDepth":1}'
```

Write a current value. Slash-containing element IDs must be URL-encoded:

```bash
curl -X PUT http://localhost:8080/i3x/v0/objects/Plant1%2FArea1%2FMotor1%2Fspeed/value \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"value":42}'
```

Read history:

```bash
curl -X POST http://localhost:8080/i3x/v0/objects/history \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{
    "elementIds": ["Plant1/Area1/Motor1/speed"],
    "startTime": "2026-04-24T00:00:00.000Z",
    "endTime": "2026-04-24T12:00:00.000Z",
    "maxValues": 1000
  }'
```

Create and stream a subscription:

```bash
SUB=$(curl -s -X POST http://localhost:8080/i3x/v0/subscriptions \
  -u admin:password | node -e "process.stdin.resume();process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).subscriptionId))")

curl -X POST "http://localhost:8080/i3x/v0/subscriptions/$SUB/register" \
  -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"elementIds":["Plant1/Area1/Motor1/speed"],"maxDepth":1}'

curl -N "http://localhost:8080/i3x/v0/subscriptions/$SUB/stream" \
  -u admin:password
```

## Project Structure

```text
.
├── index.js                  # JavaScript Manager entry point
├── server.js                 # Express application and route mounting
├── config.js                 # Runtime config loading
├── config.json               # Runtime configuration
├── auth.js                   # WinCC OA Basic Auth middleware
├── mapping/                  # WinCC OA to i3X mapping logic
├── routes/                   # Express route modules
├── subscriptions/            # In-memory subscriptions, dpConnect, SSE
├── utils/                    # Element ID, schema, quality, error helpers
├── I3X_SPEC.md               # Project-specific i3X mapping reference
├── PLAN.md                   # Original implementation plan
└── winccoa-nodejs.md         # WinCC OA Node.js API reference
```

## Development Notes

- This project is JavaScript/CommonJS only. Do not add a build step or TypeScript source files.
- WinCC OA API calls must stay inside functions, except creating `new WinccoaManager()`.
- Simple datapoints require a trailing dot when accessed directly through the WinCC OA API.
- The object hierarchy cache is invalidated on datapoint and datapoint type system events.
- Subscriptions are in memory only; they are lost when the JavaScript Manager restarts.
- There is no automated test suite configured. Verify against a running WinCC OA project with curl or an i3X client.
