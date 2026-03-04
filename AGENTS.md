# AGENTS.md — WinCC OA i3X Server

This project implements a **CESMII i3X REST API server** that runs as a **WinCC OA JavaScript Manager** using Express.js. It exposes WinCC OA datapoints, types, and historical data through the i3X REST API.

**Key references:**
- `winccoa-nodejs.md` — full WinCC OA Node.js API reference (must read)
- `I3X_SPEC.md` — i3X API spec and WinCC OA mapping details
- `PLAN.md` — architecture, file structure, endpoint table, data model

---

## Project Language: JavaScript (CommonJS)

This is a **JavaScript** project. Do NOT write TypeScript. Do NOT use TypeScript syntax (no type annotations, no `interface`, no `as` casts, no `import` statements).

- Use `'use strict';` at the top of every file
- Use `require()` for all imports — never `import`/`export`
- Use `module.exports = { ... }` or `module.exports = SomeThing` for exports
- The entry point runs directly: `node index.js` (no build step)

---

## Build / Run Commands

```bash
# No build required — plain JavaScript
node index.js

# Install dependencies
npm install
npm install --save-dev /opt/WinCC_OA/3.21/javascript/@types/winccoa-manager  # type hints only in editor

# In WinCC OA Console, configure JavaScript Manager with:
#   Command line: winccoa-i3x/index.js
```

There is no test suite or lint tool configured. Verify correctness manually:

```bash
# Test API endpoints (server must be running inside WinCC OA):
curl http://localhost:8080/i3x/v0/namespaces -u admin:password
curl http://localhost:8080/i3x/v0/objecttypes -u admin:password
curl http://localhost:8080/i3x/v0/objects -u admin:password

curl -X POST http://localhost:8080/i3x/v0/objects/value \
  -u admin:password -H "Content-Type: application/json" \
  -d '{"elementIds":["obj:Plant1/Area1/Motor1/speed"],"maxDepth":1}'

# SSE subscription test
SUB=$(curl -s -X POST http://localhost:8080/i3x/v0/subscriptions -u admin:password | node -e "process.stdin.resume();process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).subscriptionId))")
curl -N http://localhost:8080/i3x/v0/subscriptions/$SUB/stream -u admin:password
```

---

## File Structure

```
winccoa-i3x/
├── index.js                   # Manager entry point
├── config.js                  # Config loading (i3x-config.json)
├── server.js                  # Express app setup
├── auth.js                    # Basic Auth middleware
├── mapping/
│   ├── namespaces.js          # DP types → i3X Namespace
│   ├── object-types.js        # DP types → i3X ObjectType + JSON Schema
│   ├── object-instances.js    # DPs/DPEs → i3X ObjectInstance
│   ├── hierarchy.js           # CNS I3X_Hierarchy → parent/child tree
│   ├── relationships.js       # Built-in relationship type definitions
│   └── values.js              # dpGet/dpSet with VQT + quality mapping
├── routes/
│   ├── namespaces.js          # GET /namespaces
│   ├── object-types.js        # GET /objecttypes, POST /objecttypes/query
│   ├── relationship-types.js  # GET /relationshiptypes, POST /...query
│   ├── objects.js             # GET /objects, POST /objects/list, /related
│   ├── values.js              # POST /objects/value, PUT /objects/:id/value
│   ├── history.js             # POST /objects/history, PUT /.../:id/history
│   └── subscriptions.js       # Full subscription CRUD + SSE + sync
├── subscriptions/
│   ├── manager.js             # Subscription lifecycle, in-memory store
│   ├── monitor.js             # dpConnect-based monitoring
│   └── sse.js                 # SSE stream handling
├── utils/
│   ├── element-id.js          # elementId encode/decode (obj:, type:, rel:)
│   ├── json-schema.js         # WinccoaDpTypeNode → JSON Schema
│   ├── quality.js             # WinCC OA _online.._invalid → i3X quality
│   └── errors.js              # HTTP error response formatting
├── i3x-config.json            # Runtime config (port, auth, CNS view names)
└── package.json
```

---

## Code Style

### Imports and Exports

```js
'use strict';

// Imports: always require(), never import
const express = require('express');
const { WinccoaManager } = require('winccoa-manager');
const { buildNamespaceList } = require('./mapping/namespaces');

// Exports: named or default
module.exports = { buildNamespaceList, helper };
module.exports = router;  // for Express routers
```

### Formatting

- 2-space indentation
- Single quotes for strings
- Semicolons at end of statements
- `const` by default; `let` only when reassignment is needed; never `var`
- Arrow functions for short callbacks; named `async function` for complex logic
- Trailing commas in multi-line arrays/objects

### Naming Conventions

- **Variables and functions:** `camelCase`
- **Files:** `kebab-case.js`
- **Constants (config values):** `camelCase` (not SCREAMING_SNAKE)
- **Classes:** `PascalCase` (rare in this codebase)
- **WinCC OA DPE names in strings:** match WinCC OA conventions (`Motor1.speed`)

### Async Pattern

```js
// Always async/await; wrap top-level calls in async function
async function main() {
  try {
    const value = await winccoa.dpGet('Motor1.speed');
    console.info('Value:', value);
  } catch (exc) {
    console.error(exc);
  }
}

void main();  // entry point — use void, not .catch()
```

---

## WinCC OA Critical Rules

### Trailing Dot for Simple Datapoints

```js
// CORRECT — simple DP (no structure elements) needs trailing dot
await winccoa.dpGet('ExampleDP_Arg1.');
winccoa.dpSet('ExampleDP_Arg1.', 42);

// CORRECT — structured DP element (no trailing dot)
await winccoa.dpGet('Motor1.speed');

// WRONG — missing trailing dot
await winccoa.dpGet('ExampleDP_Arg1');  // ERROR
```

### API Calls Must Be Inside Functions

Never call WinCC OA API methods at module scope. Only `new WinccoaManager()` is allowed at the top level.

```js
const winccoa = new WinccoaManager();  // OK at top level

// All API calls must be inside functions:
async function setup() {
  const dps = winccoa.dpNames('Motor*', 'MotorType');  // OK
}
```

### Manager Lifecycle

The JavaScript Manager does NOT exit automatically. Call `winccoa.exit(0)` only for one-shot scripts. Long-running services (this project) keep running with active `dpConnect` subscriptions.

### require() vs import

Always use `require()` in `.js` files. This lets WinCC OA's module resolver find `winccoa-manager` and sub-project modules correctly.

### Logging

```js
// Preferred: console methods (mapped to WinCC OA log system)
console.info('Server started on port', port);
console.warn('Cache miss for type:', typeName);
console.error('Failed to read hierarchy:', err);

// Or WinccoaManager methods directly:
winccoa.logInfo('message', data);
winccoa.logSevere('message', data);
// NEVER use logFatal unless intentional — it terminates the manager
```

---

## Error Handling

### Express Route Errors

```js
// Standard error response shape (utils/errors.js):
function sendError(res, status, message, details) {
  res.status(status).json({ error: { code: status, message, details } });
}

// In routes: catch WinccoaError and map to HTTP
router.get('/objects', async (req, res) => {
  try {
    const objects = await getObjectInstances();
    res.json(objects);
  } catch (exc) {
    console.error('GET /objects failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});
```

### WinccoaError

```js
const { WinccoaError } = require('winccoa-manager');

try {
  await winccoa.dpGet('NonExistent.');
} catch (exc) {
  if (exc instanceof WinccoaError) {
    console.error('WinCC OA error code:', exc.code, 'DPE:', exc.dpe);
  } else {
    console.error(exc);
  }
}
```

### dpConnect Callbacks

Always check the `error` parameter first in connect callbacks:

```js
function onValueChange(names, values, type, error) {
  if (error) { console.error('dpConnect error:', error); return; }
  // process names[i], values[i]
}
```

---

## i3X ElementId Conventions

| Entity | Format | Example |
|--------|--------|---------|
| ObjectType | `type:{DpTypeName}` | `type:MotorType` |
| ObjectInstance (DP) | `obj:{cnsPath}` | `obj:Plant1/Area1/Motor1` |
| ObjectInstance (DPE) | `obj:{cnsPath}/{element}` | `obj:Plant1/Area1/Motor1/speed` |
| RelationshipType | `rel:{name}` | `rel:HasParent` |
| Namespace | `{uri}` | `http://winccoa.local/MotorType` |

Base path: `/i3x/v0` (from `i3x-config.json`). Configuration is loaded from `i3x-config.json` in the project root.

---

## WinCC OA API Quick Reference

Type definitions: `/opt/WinCC_OA/3.21/javascript/@types/winccoa-manager/`
Examples: `/opt/WinCC_OA/3.21/javascript/examples/`

Key async methods: `dpGet`, `dpSet`, `dpSetWait`, `dpCreate`, `dpDelete`, `dpQuery`, `dpGetPeriod`, `alertGet`, `nameCheck`, `cnsAddNode`, `cnsAddTree`

Key synchronous methods: `dpExists`, `dpNames`, `dpTypes`, `dpTypeGet`, `dpTypeName`, `dpElementType`, `cnsGetChildren`, `cnsGetViews`

Live subscriptions: `dpConnect(callback, dpe, answer)` → returns `connectId`; `dpDisconnect(connectId)`

For the full API, always consult `winccoa-nodejs.md` in this repository.
