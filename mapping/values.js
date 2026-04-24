'use strict';

const { WinccoaManager } = require('winccoa-manager');
const { mapQuality } = require('../utils/quality');
const { collectDpeLeaves, getObjectValueInfo, elementIdToDpe } = require('./hierarchy');

const winccoa = new WinccoaManager();

/**
 * Read VQT for a list of WinCC OA DPE addresses.
 * Returns [{value, quality, timestamp}, ...] in the same order.
 */
async function getDpeValues(dpeNames) {
  if (!dpeNames || dpeNames.length === 0) return [];

  const valueKeys   = dpeNames.map(d => `${d}:_online.._value`);
  const stimeKeys   = dpeNames.map(d => `${d}:_online.._stime`);
  const invalidKeys = dpeNames.map(d => `${d}:_online.._invalid`);

  const allKeys = [...valueKeys, ...stimeKeys, ...invalidKeys];
  let raw;
  try {
    raw = await winccoa.dpGet(allKeys);
  } catch (exc) {
    // err 19 = attribute does not exist (queried config on a struct node)
    if (exc && exc.code === 19) {
      console.warn('dpGet VQT: attribute does not exist —', exc.dpe || allKeys[0]);
      return dpeNames.map(() => ({ value: null, quality: 'Bad', timestamp: null }));
    }
    console.error('dpGet VQT failed:', exc);
    throw exc;
  }

  const n = dpeNames.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const value = raw[i];
    const stime = raw[n + i];
    const invalid = raw[2 * n + i];

    let timestamp = null;
    if (stime instanceof Date) timestamp = stime.toISOString();
    else if (stime !== null && stime !== undefined) timestamp = new Date(stime).toISOString();

    const noValue = value === null || value === undefined;
    out.push({
      value: noValue ? null : value,
      quality: mapQuality(invalid, noValue),
      timestamp,
    });
  }
  return out;
}

/**
 * Write a scalar value to a single DPE.
 */
async function setDpeValue(dpeName, value) {
  await winccoa.dpSetWait(dpeName, value);
}

/**
 * Read historical VQTs for a DPE.
 */
async function getDpeHistory(dpeName, startTime, endTime, maxValues) {
  const start = startTime instanceof Date ? startTime : new Date(startTime);
  const end   = endTime   instanceof Date ? endTime   : new Date(endTime);
  const limit = maxValues || 1000;

  let results;
  try {
    results = await winccoa.dpGetPeriod(start, end, [`${dpeName}:_offline.._value`], limit);
  } catch (exc) {
    console.error(`dpGetPeriod failed for ${dpeName}:`, exc);
    throw exc;
  }
  if (!results || results.length === 0) return [];
  const r0 = results[0];
  if (!r0 || !r0.values || r0.values.length === 0) return [];

  const out = [];
  for (let i = 0; i < r0.values.length; i++) {
    const v = r0.values[i];
    const t = r0.times[i] instanceof Date ? r0.times[i] : new Date(r0.times[i]);
    out.push({
      value: v !== null && v !== undefined ? v : null,
      quality: mapQuality(false, v === null || v === undefined),
      timestamp: t.toISOString(),
    });
  }
  return out;
}

// ── Object-level reads (struct-aware) ─────────────────────────────────────

const QUALITY_RANK = { Good: 0, GoodNoData: 1, Uncertain: 2, Bad: 3 };

/**
 * Merge the qualities of a set of VQTs. Returns the worst.
 */
function worstQuality(vqts) {
  let worst = 'Good';
  for (const v of vqts) {
    if ((QUALITY_RANK[v.quality] ?? 3) > (QUALITY_RANK[worst] ?? 0)) worst = v.quality;
  }
  return worst;
}

/**
 * Pick a representative timestamp — the latest non-null across the set.
 * Falls back to "now" if every leaf has a null timestamp.
 */
function latestTimestamp(vqts) {
  let latest = null;
  for (const v of vqts) {
    if (!v.timestamp) continue;
    if (!latest || v.timestamp > latest) latest = v.timestamp;
  }
  return latest || new Date().toISOString();
}

/**
 * Assemble leaf VQT values into a nested JSON object matching the struct
 * shape. `leaves` is `[{relPath, value}]` where relPath is dot-separated.
 *   `[{relPath: 'state.on', value: true}, {relPath: 'speed', value: 42}]`
 *   → `{ state: { on: true }, speed: 42 }`
 */
function assembleStructValue(leaves) {
  if (leaves.length === 1 && leaves[0].relPath === '') return leaves[0].value;
  const out = {};
  for (const { relPath, value } of leaves) {
    const parts = relPath.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] === undefined) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

/**
 * Read the full current value of an ObjectInstance. Handles scalar DPs and
 * arbitrarily nested struct DPs (and CNS-linked struct sub-paths).
 *
 * @param {string} elementId
 * @returns {Promise<{value, quality, timestamp} | null>}
 *          null when the elementId is unknown or refers to a folder.
 */
async function readObjectValue(elementId) {
  const info = await getObjectValueInfo(elementId);
  if (!info) return null;

  const leaves = await collectDpeLeaves(info);
  if (leaves.length === 0) return null;

  const vqts = await getDpeValues(leaves.map(l => l.dpe));
  const assembled = leaves.map((l, i) => ({ relPath: l.relPath, value: vqts[i].value }));

  return {
    value: assembleStructValue(assembled),
    quality: worstQuality(vqts),
    timestamp: latestTimestamp(vqts),
  };
}

/**
 * Read historical VQTs for an ObjectInstance. Only supported for primitive-
 * leaf objects — history on a struct root is not well-defined.
 *
 * Returns `{ values: VQT[] }` for a leaf, or `null` for struct roots.
 */
async function readObjectHistory(elementId, startTime, endTime, maxValues) {
  const info = await getObjectValueInfo(elementId);
  if (!info) return null;

  const leaves = await collectDpeLeaves(info);
  if (leaves.length !== 1 || leaves[0].relPath !== '') return null;  // struct, not a leaf

  const values = await getDpeHistory(leaves[0].dpe, startTime, endTime, maxValues);
  return { values };
}

/**
 * Write a scalar value to an ObjectInstance that resolves to a single DPE.
 * Returns true on success, false if the elementId does not map to a leaf.
 */
async function writeObjectValue(elementId, value) {
  const dpe = await elementIdToDpe(elementId);
  if (!dpe) return false;
  await setDpeValue(dpe, value);
  return true;
}

module.exports = {
  getDpeValues,
  setDpeValue,
  getDpeHistory,
  readObjectValue,
  readObjectHistory,
  writeObjectValue,
};
