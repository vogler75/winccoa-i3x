# WinCC OA Node.js Manager Development Skill

You are an expert in WinCC OA Node.js Manager development. Use this comprehensive reference to create, modify, and maintain WinCC OA JavaScript/TypeScript manager programs.

---

## CRITICAL RULES

### Internal Datapoints (names starting with "_")
Datapoints whose name starts with `_` (e.g. `_mp_ANALOG1`, `_Connections`, `_DriverState`) are **WinCC OA internal/system datapoints**. They should be **excluded** from user-facing APIs and browsing UIs. Always filter them out when enumerating DPs:

```js
const dpList = winccoa.dpNames('*', typeName).filter(dp => !stripSystemPrefix(dp).startsWith('_'));
```

Likewise, skip DP types starting with `_` (e.g. `_DriverConnection`, `_HQ`):
```js
const typeNames = winccoa.dpTypes('*').filter(t => !t.startsWith('_'));
```

### Datapoint (Tag) Addressing with Trailing Dot
**A datapoint without any structure element MUST be addressed with a trailing dot.**
This applies when the datapoint type has no structure (only a single element).

```ts
// CORRECT - trailing dot for datapoints without structure elements
const value = await winccoa.dpGet('ExampleDP_Arg1.');
winccoa.dpSet('ExampleDP_Arg1.', 42);
winccoa.dpConnect(callback, 'ExampleDP_Arg1.');

// CORRECT - structured datapoint with element path (no trailing dot needed)
const value = await winccoa.dpGet('Motor1.speed');
const value = await winccoa.dpGet('Motor1.config.maxSpeed');

// WRONG - missing trailing dot for simple datapoint type
const value = await winccoa.dpGet('ExampleDP_Arg1');  // ERROR!
```

### Full DPE Address Format
```
[SystemName:]DpName[.Element][.Element...][:ConfigName[.DetailName[.AttributeName]]]
```
Examples:
```
System1:ExampleDP_Arg1.                           → simple DP value
System1:ExampleDP_Arg1.:_original.._value         → original value attribute
System1:Motor1.speed:_original.._value            → structured DP element value
System1:ExampleDP_AlertHdl1.:_alert_hdl.._act_state → alert attribute
```

### Code Must Be Inside Functions
All WinCC OA API calls must be placed inside a function or method. Do not call API methods at the top-level module scope (except `new WinccoaManager()`).

### Manager Stays Running
The JavaScript Manager does NOT terminate automatically when a script finishes. It keeps running due to the live connection with WinCC OA. Call `winccoa.exit(0)` explicitly if you want it to stop after one-shot tasks.

---

## PROJECT SETUP FROM SCRATCH

### TypeScript Project (Recommended)

1. Create the project directory inside the WinCC OA project's `javascript/` folder:
```bash
mkdir -p <project>/javascript/<modulename>
cd <project>/javascript/<modulename>
```

2. Create `package.json`:
```json
{
  "name": "<modulename>",
  "version": "0.1.0",
  "devDependencies": {
    "@types/node": "^22.18.1",
    "typescript": "^5.9.2"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w"
  }
}
```

3. Create `tsconfig.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "include": ["**/*"],
  "compilerOptions": {
    "module": "Node16",
    "target": "es2021",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node16",
    "sourceMap": true
  }
}
```

4. Install dependencies (include path to WinCC OA type definitions):
```bash
npm install
npm install --save-dev /opt/WinCC_OA/3.21/javascript/@types/winccoa-manager
```

5. Create `index.ts`:
```ts
import { WinccoaManager } from 'winccoa-manager';
const winccoa = new WinccoaManager();

async function main() {
  try {
    // Your code here
    console.info('Manager started successfully');
  } catch (exc) {
    console.error(exc);
  }
}

void main();
```

6. Build and configure:
```bash
npx tsc
```
Add a JavaScript Manager in WinCC OA Console with command line: `<modulename>/index.js`

### JavaScript Project (No Transpilation Required)

1. Create `package.json`:
```json
{
  "name": "<modulename>",
  "version": "0.1.0"
}
```

2. Create `index.js`:
```js
'use strict';
const { WinccoaManager } = require('winccoa-manager');
const winccoa = new WinccoaManager();

async function main() {
  try {
    console.info('Manager started successfully');
  } catch (exc) {
    console.error(exc);
  }
}

void main();
```

---

## MANAGER CONSTRUCTOR & OPTIONS

```ts
import { WinccoaManager, WinccoaTimeFormat, WinccoaLangStringFormat } from 'winccoa-manager';

const winccoa = new WinccoaManager({
  timeFormat: WinccoaTimeFormat.Number,         // 0=Date objects, 1=milliseconds since epoch
  langStringFormat: WinccoaLangStringFormat.Object, // 0=active lang string, 1=fixed lang string, 2=object, 3=array
  longAsBigInt: true,                           // return long/ulong as BigInt
  splitTimeout: 60000,                          // timeout for split requests in ms
});

// Get/set options at runtime
const opts = winccoa.getOptions();
winccoa.setOptions({ timeFormat: WinccoaTimeFormat.Date });
```

**Only one logical manager instance exists.** Multiple `new WinccoaManager()` calls in different files all share the same connection. Options set on one affect all.

---

## COMPLETE API REFERENCE

### Manager Core

| Method | Description |
|--------|-------------|
| `getOptions(): WinccoaOptions` | Get current options |
| `setOptions(opts: Partial<WinccoaOptions>): boolean` | Set options |
| `getVersionInfo(): WinccoaVersionDetails` | Get API and WinCC OA version info |
| `getPaths(): string[]` | Get project/installation paths |
| `exit(exitCode?: number): void` | Exit the manager |
| `registerExitCallback(cb: () => Promise<void>): void` | Register cleanup handler before exit |
| `isDbgFlag(flag: string \| number): boolean` | Check if a debug flag is set |
| `findFile(name: string): string` | Find a file in the project/installation paths |

### Logging

```ts
winccoa.logInfo('message', data);           // Info level
winccoa.logWarning('message', data);        // Warning level
winccoa.logSevere('message', data);         // Severe level
winccoa.logFatal('message', data);          // Fatal level (terminates manager!)
winccoa.logDebugF('REDU', 'message');       // Debug with flag
winccoa.securityEvent(WinccoaSecurityEventId.PortOpened, port, 'https://');

// Alternative: use console methods (wrapped to WinCC OA log)
console.info('message');    // → logInfo
console.warn('message');    // → logWarning
console.error('message');   // → logSevere

// Standalone log object (no WinccoaManager instance needed)
import { log } from 'winccoa-manager';
log.info('message');
log.warning('message');
log.severe('message');
log.fatal('message');
log.debugF('FLAG', 'message');
```

### Data Point Existence & Query (Synchronous)

```ts
winccoa.dpExists('MyDP.'): boolean
winccoa.dpNames('Motor*', 'MotorType'): string[]       // pattern, optional dpType filter
winccoa.dpNames('*', '', true): string[]                // ignoreCase
winccoa.dpTypes('Motor*'): string[]                     // list DP types
winccoa.dpTypes('*', systemId, true): string[]          // include empty types
winccoa.dpTypeName('MyDP.'): string                     // get type name of a DP
winccoa.dpTypeRefName('MyDP.element'): string           // get type reference name
winccoa.dpElementType('MyDP.element'): WinccoaElementType  // get element type
winccoa.dpSubStr('System1:MyDP.el:_original.._value', WinccoaDpSub.DP): string  // extract substring
winccoa.dpGetId('MyDP.'): number[]                      // returns [dpId, elemId]
winccoa.dpGetName(dpId, elemId): string                 // reverse of dpGetId
```

### Data Point Get (Async)

```ts
// Single value
const value = await winccoa.dpGet('MyDP.');

// Multiple values - returns array
const [v1, v2] = await winccoa.dpGet(['MyDP.', 'MyDP2.speed']) as [number, number];

// With attributes
const [val, time] = await winccoa.dpGet([
  'MyDP.:_original.._value',
  'MyDP.:_original.._stime'
]) as [number, Date];

// Get with max age (cached value, seconds)
const value = await winccoa.dpGetMaxAge(5, 'MyDP.');

// Direct read from driver (bypasses Event Manager cache)
const value = await winccoa.dpDirectRead('MyDP.', 5000);  // timeout in ms
```

### Data Point Set

```ts
// Fire-and-forget (no confirmation)
winccoa.dpSet('MyDP.', 42);
winccoa.dpSet(['MyDP.', 'MyDP2.speed'], [42, 100.5]);

// Wait for confirmation from Event Manager
await winccoa.dpSetWait('MyDP.', 42);
await winccoa.dpSetWait(['MyDP.', 'MyDP2.speed'], [42, 100.5]);

// Set with timestamp
winccoa.dpSetTimed(new Date(), 'MyDP.', 42);
await winccoa.dpSetTimedWait(new Date(), 'MyDP.', 42);

// Direct write to driver (bypasses Event Manager)
await winccoa.dpDirectWrite('MyDP.', 42, 5000);          // timeout in ms
await winccoa.dpDirectWriteTimed(new Date(), 'MyDP.', 42, 5000);
```

### Data Point Connect (Live Subscriptions)

```ts
import { WinccoaConnectUpdateType, WinccoaError } from 'winccoa-manager';

// dpConnect - subscribe to value changes
function connectCB(
  names: string[],
  values: unknown[],
  type: WinccoaConnectUpdateType,
  error?: WinccoaError
) {
  if (error) { console.error(error); return; }
  if (type === WinccoaConnectUpdateType.Answer)
    console.info('Initial values received');
  for (let i = 0; i < names.length; i++)
    console.info(`${names[i]} = ${values[i]}`);
}

// Subscribe (answer=true means get initial values immediately)
const id = winccoa.dpConnect(connectCB, ['MyDP.', 'MyDP2.'], true);

// Subscribe to single DPE
const id = winccoa.dpConnect(connectCB, 'MyDP.', true);

// Unsubscribe
winccoa.dpDisconnect(id);

// Extended connect (get extra attributes alongside values)
function extCB(
  names: string[], values: unknown[],
  namesExt: string[], valuesExt: unknown[],
  type: WinccoaConnectUpdateType, error?: WinccoaError
) { /* ... */ }

const id = winccoa.dpConnectExt(
  extCB,
  'MyDP.:_original.._value',
  'MyDP.:_original.._stime',
  true
);
winccoa.dpDisconnectExt(id);
```

### Data Point Query (SQL-like)

```ts
// dpQuery returns table: [header_row, data_row1, data_row2, ...]
const result = await winccoa.dpQuery(
  "SELECT '_original.._value' FROM 'Motor*' WHERE _DPT=\"MotorType\""
);
// result[0] = ['', ':_original.._value']  (header)
// result[1] = ['System1:Motor1.', 42]     (data)

// Query connect (live subscription to query results)
function queryCB(values: unknown[][], type: WinccoaConnectUpdateType, error?: WinccoaError) {
  if (error) { console.error(error); return; }
  for (let i = 1; i < values.length; i++) {  // skip header at index 0
    console.info(`${values[i][0]} = ${values[i][1]}`);
  }
}

// ConnectAll: callback receives ALL matching DPEs on each update
const id = winccoa.dpQueryConnectAll(queryCB, true,
  "SELECT '_online.._value' FROM '*' WHERE _DPT=\"MotorType\"");

// ConnectSingle: callback receives ONLY changed DPEs
const id = winccoa.dpQueryConnectSingle(queryCB, true,
  "SELECT '_original.._value' FROM 'Motor*'");

// With blocking time (collect changes over period, then deliver as batch)
const id = winccoa.dpQueryConnectSingle(queryCB, true,
  "SELECT '_original.._value' FROM 'Motor*'", 1000);  // 1 second

winccoa.dpQueryDisconnect(id);

// Split query (for large result sets, returns data in chunks)
const result = await winccoa.dpQuerySplit("SELECT '_original.._value' FROM '*'");
// result = { id, answerId, progress, data }
// Call repeatedly until progress === 100

winccoa.dpCancelSplitRequest(result.id);
```

### Data Point Create/Delete/Copy

```ts
// Create a datapoint
await winccoa.dpCreate('NewMotor', 'MotorType');
await winccoa.dpCreate('NewMotor', 'MotorType', systemId);

// Delete a datapoint
await winccoa.dpDelete('NewMotor');

// Copy a datapoint (copies values and configs)
await winccoa.dpCopy('Motor1', 'Motor2');
```

### Data Point Type Management

```ts
import { WinccoaDpTypeNode, WinccoaElementType } from 'winccoa-manager';

// Get type structure
const typeNode = winccoa.dpTypeGet('MotorType');
const typeNode = winccoa.dpTypeGet('MotorType', true);  // include subtypes

// Create a new type
const root = new WinccoaDpTypeNode('SimpleType', WinccoaElementType.Struct, '', [
  new WinccoaDpTypeNode('value', WinccoaElementType.Float),
  new WinccoaDpTypeNode('status', WinccoaElementType.Int),
  new WinccoaDpTypeNode('name', WinccoaElementType.String),
]);
await winccoa.dpTypeCreate(root);

// Create type with nested structure
const complexType = new WinccoaDpTypeNode('ComplexType', WinccoaElementType.Struct, '', [
  new WinccoaDpTypeNode('config', WinccoaElementType.Struct, '', [
    new WinccoaDpTypeNode('maxSpeed', WinccoaElementType.Float),
    new WinccoaDpTypeNode('enabled', WinccoaElementType.Bool),
  ]),
  new WinccoaDpTypeNode('readings', WinccoaElementType.Struct, '', [
    new WinccoaDpTypeNode('temperature', WinccoaElementType.Float),
    new WinccoaDpTypeNode('pressure', WinccoaElementType.Float),
  ]),
]);
await winccoa.dpTypeCreate(complexType);

// Modify an existing type (add/rename elements)
await winccoa.dpTypeChange(modifiedTypeNode);

// Delete a type
await winccoa.dpTypeDelete('OldType');

// Query type references
const refs = winccoa.dpGetDpTypeRefs('MotorType');    // { refNames, dpePaths }
const refs = winccoa.dpGetRefsToDpType('SensorRef');  // { dptNames, dpePaths }
```

### Data Point Metadata

```ts
// Alias
const alias = winccoa.dpGetAlias('MyDP.');
const dpName = winccoa.dpAliasToName('my_alias');
await winccoa.dpSetAlias('MyDP.', 'my_alias');
const { aliases, dpNames } = winccoa.dpGetAllAliases('*filter*', '*dpfilter*');

// Description (multi-language)
const desc = winccoa.dpGetDescription('MyDP.');
await winccoa.dpSetDescription('MyDP.', { 'en_US.utf8': 'English desc', 'de_AT.utf8': 'Deutsche Beschr.' });
const { dpNames, descriptions } = winccoa.dpGetAllDescriptions();

// Unit and Format (multi-language)
const unit = winccoa.dpGetUnit('MyDP.');
await winccoa.dpSetUnit('MyDP.', 'kg');
const format = winccoa.dpGetFormat('MyDP.');
await winccoa.dpSetFormat('MyDP.', '%5.2f');
```

### Data Point Configs & Attributes

```ts
// Get all configs for a DP element or type
const configs = winccoa.dpGetAllConfigs('MyDP.element');
const configs = winccoa.dpGetAllConfigs(WinccoaElementType.Float);

// Get all details for a config
const details = winccoa.dpGetAllDetails('_alert_hdl');

// Get all attributes for a config
const attrs = winccoa.dpGetAllAttributes('_alert_hdl');
```

### Wait for Value / Set and Wait

```ts
// Wait until a DPE reaches a specific value (with timeout)
const result = await winccoa.dpWaitForValue(
  ['MyDP.status'],          // DPEs to watch
  [1],                      // conditions (values to wait for)
  ['MyDP.result'],          // DPEs to return when condition is met
  10000                     // timeout in ms
);

// Set a value and wait for another to change
const result = await winccoa.dpSetAndWaitForValue(
  ['MyDP.command'],         // DPEs to set
  [1],                      // values to set
  ['MyDP.status'],          // DPEs to watch
  [1],                      // conditions
  ['MyDP.result'],          // DPEs to return
  10000                     // timeout in ms
);
```

### Historical Data (dpGetPeriod)

```ts
const startTime = new Date('2024-01-01');
const endTime = new Date('2024-01-02');

const results = await winccoa.dpGetPeriod(
  startTime, endTime,
  ['MyDP.:_offline.._value'],
  0  // 0 = all values, >0 = max count
);
// results = [{ times: Date[], values: unknown[] }]

// Split version for large datasets
const result = await winccoa.dpGetPeriodSplit(startTime, endTime, ['MyDP.'], 0);
```

### Alert Management

```ts
import { WinccoaAlertTime } from 'winccoa-manager';

// Get alert information
const alertData = await winccoa.alertGet(alertTime, 'MyDP.');

// Set alert attributes
const at = new WinccoaAlertTime(new Date(), 1, 'MyDP.:_alert_hdl.._comment');
winccoa.alertSet(at, 'Alert acknowledged');
await winccoa.alertSetWait(at, 'Alert acknowledged');

// With timestamp
winccoa.alertSetTimed(new Date(), at, 'Alert comment');
await winccoa.alertSetTimedWait(new Date(), at, 'Alert comment');

// Historical alerts
const result = await winccoa.alertGetPeriod(startTime, endTime, 'MyDP.');
```

### System Events (sysConnect)

```ts
import { WinccoaSysConEvent } from 'winccoa-manager';

// Subscribe to system events (EventEmitter pattern)
winccoa.sysConnect.on(WinccoaSysConEvent.DpCreated, (details) => {
  console.info(`DP created: ${details.dp} (type: ${details.dpType})`);
});

winccoa.sysConnect.on(WinccoaSysConEvent.DpDeleted, (details) => {
  console.info(`DP deleted: ${details.dp}`);
});

winccoa.sysConnect.on(WinccoaSysConEvent.DpRenamed, (details) => {
  console.info(`DP renamed: ${details.oldName} → ${details.newName}`);
});

winccoa.sysConnect.on(WinccoaSysConEvent.DpTypeCreated, (details) => {
  console.info(`DPType created: ${details.dpType}`);
});

winccoa.sysConnect.on(WinccoaSysConEvent.Redu, (details) => {
  console.info(`REDU event: ${details.reason}`);
});

winccoa.sysConnect.on(WinccoaSysConEvent.Dist, (details) => {
  console.info(`DIST event: ${details.reason}`);
});

// Available events: DpCreated, DpDeleted, DpRenamed, DpAlias, DpDescription,
//   DpFormatUnit, DpTypeCreated, DpTypeDeleted, DpTypeChanged, Redu, Dist

// For exit handling, use process.prependListener (NOT process.on):
process.prependListener('exit', () => {
  console.info('Manager is shutting down');
});
```

### CTRL Script Execution

```ts
import { WinccoaCtrlScript, WinccoaCtrlType } from 'winccoa-manager';

// Create and execute CTRL code
const script = new WinccoaCtrlScript(
  winccoa,
  `dyn_string main(string pattern) {
    return dpTypes(pattern, getSystemId());
  }`,
  'my script'
);

const types = await script.start('main', ['Motor*'], [WinccoaCtrlType.string]) as string[];

// Load CTRL script from file
const script = await WinccoaCtrlScript.fromFile(winccoa, 'myScript.ctl');

// With callback from CTRL to JavaScript
const callback = (value?: unknown) => {
  console.info('Called from CTRL with:', value);
  return 'response from JS';
};
const script = new WinccoaCtrlScript(winccoa, ctrlCode, 'name', callback);

// In CTRL code, call: callbackToJavaScript(value, returnValue)

// Stop running script threads
script.stop();
```

### System & Redundancy

```ts
winccoa.getSystemId(): number                    // current system ID
winccoa.getSystemId('OtherSystem'): number       // named system ID
winccoa.getSystemName(): string                  // current system name
winccoa.getSystemName(2): string                 // system name by ID
winccoa.getProjectLangs(): string[]              // e.g. ['de_AT.utf8', 'en_US.utf8']
winccoa.setUserId(id, password?): boolean        // switch user context
winccoa.getUserId(): number                      // current user ID
winccoa.getUserId('operatorAll'): number          // user ID by name
winccoa.getUserName(): string                    // current user name
winccoa.getUserName(2048): string                // user name by ID
winccoa.isRedundant(): boolean                   // is REDU configured?
winccoa.isReduActive(): boolean                  // is REDU currently active?
winccoa.myReduHost(): string                     // current REDU host name
winccoa.myReduHostNum(): number                  // 1 or 2
winccoa.otherReduHost(): string                  // partner REDU host
```

### Name Validation

```ts
import { WinccoaNameCheckType } from 'winccoa-manager';

const result = await winccoa.nameCheck('MyDP', WinccoaNameCheckType.Dp);
// result = { valid: boolean, name: string }

// Forbidden chars for DP names: . : , ; * ? [ ] { } $ @
// Forbidden chars for project names: \ / " ? < > * | : ;
```

### Configuration File Access

```ts
import { WinccoaDirectoryLevel } from 'winccoa-manager';

const config = winccoa.cfgReadContent();                           // default config
const config = winccoa.cfgReadContent('myConfig');                  // named config
const config = winccoa.cfgReadContent('config', WinccoaDirectoryLevel.Proj);    // project level
const config = winccoa.cfgReadContent('config', WinccoaDirectoryLevel.WinCCOA); // installation level
```

### CNS (Configuration Naming System)

```ts
import { WinccoaCnsNodeType, WinccoaCnsSearchMode, WinccoaCnsTreeNode, WinccoaCnsSubStrFlags } from 'winccoa-manager';

// Query CNS
winccoa.cnsGetId('System1.View1:Node1');
winccoa.cnsGetIdSet('*pattern*');
winccoa.cnsGetIdSet('*', 'System1.View1:', WinccoaCnsSearchMode.Name);
winccoa.cnsGetNodesByName('*Motor*');
winccoa.cnsGetNodesByData('Motor1');
winccoa.cnsGetProperty('System1.View1:Node1', 'key');
winccoa.cnsGetPropertyKeys('System1.View1:Node1');
winccoa.cnsGetDisplayPath('System1.View1:Node1');
winccoa.cnsGetDisplayNames('System1.View1:Node1');
winccoa.cnsGetRoot('System1.View1:Node1/Sub');
winccoa.cnsGetParent('System1.View1:Node1/Sub');
winccoa.cnsGetChildren('System1.View1:Node1');
winccoa.cnsGetViews('System1');
winccoa.cnsGetTrees('System1.View1');
winccoa.cnsSubStr('System1.View1:Path/Node', WinccoaCnsSubStrFlags.Node);

// Modify CNS
await winccoa.cnsCreateView('System1.NewView', { 'en_US.utf8': 'New View' }, '/');
await winccoa.cnsDeleteView('System1.OldView');
await winccoa.cnsAddNode('System1.View1:', 'NewNode', { 'en_US.utf8': 'Display Name' }, 'Motor1');
const tree = new WinccoaCnsTreeNode('Root', { 'en_US.utf8': 'Root' }, '', [
  new WinccoaCnsTreeNode('Child1', { 'en_US.utf8': 'Child 1' }, 'Motor1'),
]);
await winccoa.cnsAddTree('System1.View1:', tree);
await winccoa.cnsChangeTree('System1.View1:Root', modifiedTree);
await winccoa.cnsDeleteTree('System1.View1:Root');
await winccoa.cnsSetProperty('System1.View1:Node1', 'key', 5, WinccoaCtrlType.int);
await winccoa.cnsSetUserData('System1.View1:Node1', Buffer.from([1, 2, 3]));

// CNS Observers
const obsId = winccoa.cnsAddObserver((path, changeType, action) => {
  console.info(`CNS change: ${path}, type: ${changeType}, action: ${action}`);
});
winccoa.cnsRemoveObserver(obsId);

// CNS async validation
await winccoa.cns_nodeExists('System1.View1:Node');
await winccoa.cns_viewExists('System1.View1');
await winccoa.cns_treeExists('System1.View1:Tree');
await winccoa.cns_isNode('System1.View1:Node');
```

---

## KEY ENUMERATIONS

### WinccoaElementType (for dpTypeCreate)
`Struct(1)`, `Int(21)`, `UInt(20)`, `Float(22)`, `Bool(23)`, `Bit32(24)`, `String(25)`, `Time(26)`, `Char(19)`, `Blob(46)`, `LangString(42)`, `Long(54)`, `ULong(58)`, `Bit64(50)`, `Dpid(27)`, `Typeref(41)`, and all Dyn* and *Struct variants.

### WinccoaConnectUpdateType
`Normal(0)` - value change, `Answer(1)` - initial values, `Refresh(2)` - after REDU/DIST reconnect.

### WinccoaDpSub (for dpSubStr)
`SYS(32)`, `DP(16)`, `DP_EL(24)`, `CONF(4)`, `ALL(65535)`, and combinations like `SYS_DP(48)`, `SYS_DP_EL(56)`, `DP_EL_CONF(28)`, `DP_EL_CONF_DET(30)`, `DP_EL_CONF_DET_ATT(31)`.

### WinccoaCtrlType (for CTRL script parameters)
`bool`, `int`, `uint`, `float`, `double`, `string`, `time`, `atime`, `char`, `bit32`, `bit64`, `blob`, `long`, `ulong`, `langString`, and all `dyn_*` and `dyn_dyn_*` variants.

### WinccoaErrorPriority
`Fatal(0)`, `Severe(1)`, `Warning(2)`, `Info(3)`.

### WinccoaErrorType
`Implementation(0)`, `Parameter(1)`, `System(2)`, `Control(3)`, `Redundancy(4)`.

---

## ERROR HANDLING

```ts
import { WinccoaError } from 'winccoa-manager';

try {
  await winccoa.dpGet('NonExistent.');
} catch (exc) {
  if (exc instanceof WinccoaError) {
    console.error(`Code: ${exc.code}`);
    console.error(`Catalog: ${exc.catalog}`);
    console.error(`Priority: ${exc.priority}`);      // WinccoaErrorPriority
    console.error(`ErrorType: ${exc.errorType}`);    // WinccoaErrorType
    console.error(`DPE: ${exc.dpe}`);
    console.error(`Details: ${exc.details}`);
    console.error(`Time: ${exc.errorTime}`);

    // Multiple errors bundled
    if (exc.multipleErrors) {
      const errors = exc.code as WinccoaError[];
      errors.forEach(e => console.error(e.toString()));
    }
  }
}
```

---

## UTILITY FUNCTIONS

```ts
import { delay, log, isDbgFlag } from 'winccoa-manager';

await delay(1, 500);           // wait 1.5 seconds
log.info('standalone log');     // log without WinccoaManager instance
log.debugF('FLAG', 'message'); // conditional debug log
const dbg = isDbgFlag('REDU'); // check debug flag
```

---

## COMMON PATTERNS

### Long-Running Service with dpConnect
```ts
import { WinccoaManager, WinccoaConnectUpdateType, WinccoaError } from 'winccoa-manager';
const winccoa = new WinccoaManager();

function onValueChange(names: string[], values: unknown[], type: WinccoaConnectUpdateType, error?: WinccoaError) {
  if (error) { console.error(error); return; }
  console.info(`${names[0]} changed to ${values[0]}`);
}

async function main() {
  const id = winccoa.dpConnect(onValueChange, 'MyDP.', true);
  console.info(`Subscribed with id ${id}`);
  // Manager keeps running - no need for winccoa.exit()
}

void main();
```

### One-Shot Script (Runs and Exits)
```ts
import { WinccoaManager } from 'winccoa-manager';
const winccoa = new WinccoaManager();

async function main() {
  try {
    const dps = winccoa.dpNames('Motor*', 'MotorType');
    for (const dp of dps) {
      const val = await winccoa.dpGet(dp + '.speed');
      console.info(`${dp}.speed = ${val}`);
    }
  } catch (exc) {
    console.error(exc);
  }
  winccoa.exit(0);
}

void main();
```

### User Data with Callbacks (Arrow Function Pattern)
```ts
function myCallback(userData: string, names: string[], values: unknown[], type: WinccoaConnectUpdateType) {
  console.info(`[${userData}] ${names[0]} = ${values[0]}`);
}

// Wrap with arrow function to pass user data
const id = winccoa.dpConnect(
  (names, values, type, error) => myCallback('motor-monitor', names, values, type),
  'Motor1.speed',
  true
);
```

---

## IMPORTANT NOTES

- **require() vs import**: In JavaScript files, always use `require()` which allows the manager to find modules in sub-projects and the WinCC OA installation. TypeScript `import` statements get transpiled to `require()` automatically.
- **TypeScript definitions** are at: `/opt/WinCC_OA/3.21/javascript/@types/winccoa-manager/`
- **Examples** are at: `/opt/WinCC_OA/3.21/javascript/examples/`
- **Templates** are at: `/opt/WinCC_OA/3.21/javascript/templates/`
- The JavaScript Manager command line parameter is the path to `index.js` relative to the project's `javascript/` directory.
- `dpSet()` is fire-and-forget. Use `dpSetWait()` if you need confirmation that the value was applied.
- `dpQuery()` uses WinCC OA SQL-like syntax, not standard SQL.
- Connect callbacks may be `async` functions (returning `Promise<void>`).
