'use strict';

const { WinccoaManager } = require('winccoa-manager');
const { mapQuality } = require('../utils/quality');
const { elementIdToDpe } = require('./hierarchy');

const winccoa = new WinccoaManager();

/**
 * Read last-known values (VQT) for a list of DPE names.
 *
 * @param {string[]} dpeNames  WinCC OA DPE addresses e.g. ["Motor1.speed", "Motor1.temp"]
 * @returns {Promise<Array<{value, quality, timestamp}>>}
 */
async function getDpeValues(dpeNames) {
  if (!dpeNames || dpeNames.length === 0) return [];

  // Build triples: [value, stime, invalid] for each DPE
  const valueKeys = dpeNames.map(d => `${d}:_online.._value`);
  const stimeKeys = dpeNames.map(d => `${d}:_online.._stime`);
  const invalidKeys = dpeNames.map(d => `${d}:_online.._invalid`);

  const allKeys = [...valueKeys, ...stimeKeys, ...invalidKeys];
  let rawValues;
  try {
    rawValues = await winccoa.dpGet(allKeys);
  } catch (exc) {
    // WinCC OA error 19 = attribute doesn't exist (struct node queried as leaf)
    // Return nulls for all rather than crashing the whole batch
    if (exc && exc.code === 19) {
      console.warn('dpGet VQT: attribute does not exist (struct node?) —', exc.dpe || allKeys[0]);
      return dpeNames.map(() => ({ value: null, quality: 'Bad', timestamp: null }));
    }
    console.error('dpGet VQT failed:', exc);
    throw exc;
  }

  const n = dpeNames.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const value = rawValues[i];
    const stime = rawValues[n + i];
    const invalid = rawValues[2 * n + i];

    let timestamp = null;
    if (stime instanceof Date) {
      timestamp = stime.toISOString();
    } else if (stime !== null && stime !== undefined) {
      timestamp = new Date(stime).toISOString();
    }

    const noValue = value === null || value === undefined;
    result.push({
      value: noValue ? null : value,
      quality: mapQuality(invalid, noValue),
      timestamp,
    });
  }

  return result;
}

/**
 * Read values for a list of elementIds.
 * Resolves each elementId → DPE name via hierarchy cache, then calls dpGet.
 *
 * @param {string[]} elementIds
 * @returns {Promise<Object>}  Map of elementId → {value, quality, timestamp} | null
 */
async function getValuesByElementIds(elementIds) {
  const result = {};

  // Resolve elementId → dpeName
  const dpeNames = [];
  const resolvedIds = [];

  for (const eid of elementIds) {
    const dpe = await elementIdToDpe(eid);
    if (dpe) {
      dpeNames.push(dpe);
      resolvedIds.push(eid);
    } else {
      // Not a leaf DPE — return null entry
      result[eid] = null;
    }
  }

  if (dpeNames.length === 0) return result;

  const vqts = await getDpeValues(dpeNames);
  for (let i = 0; i < resolvedIds.length; i++) {
    result[resolvedIds[i]] = vqts[i];
  }

  return result;
}

/**
 * Write a value to a single DPE.
 *
 * @param {string} dpeName   WinCC OA DPE address e.g. "Motor1.speed"
 * @param {*} value          Value to write
 * @returns {Promise<void>}
 */
async function setDpeValue(dpeName, value) {
  await winccoa.dpSetWait(dpeName, value);
}

/**
 * Read historical values for a DPE over a time range.
 *
 * @param {string} dpeName
 * @param {Date|string} startTime
 * @param {Date|string} endTime
 * @param {number} [maxValues=1000]
 * @returns {Promise<Array<{value, quality, timestamp}>>}
 */
async function getDpeHistory(dpeName, startTime, endTime, maxValues) {
  const start = startTime instanceof Date ? startTime : new Date(startTime);
  const end = endTime instanceof Date ? endTime : new Date(endTime);
  const limit = maxValues || 1000;

  // dpGetPeriod(startTime, endTime, dpeArray, maxCount)
  // Returns: [{ times: Date[], values: unknown[] }] — one entry per DPE in the array
  let results;
  try {
    results = await winccoa.dpGetPeriod(
      start,
      end,
      [`${dpeName}:_offline.._value`],
      limit,
    );
  } catch (exc) {
    console.error(`dpGetPeriod failed for ${dpeName}:`, exc);
    throw exc;
  }

  if (!results || results.length === 0) return [];

  // results[0] = { times: Date[], values: unknown[] } for _offline.._value
  const valResult = results[0];

  if (!valResult || !valResult.values || valResult.values.length === 0) return [];

  const result = [];
  for (let i = 0; i < valResult.values.length; i++) {
    const v = valResult.values[i];
    const rawTime = valResult.times[i];
    const t = rawTime instanceof Date ? rawTime : new Date(rawTime);
    result.push({
      value: v !== null && v !== undefined ? v : null,
      quality: mapQuality(false, v === null || v === undefined),
      timestamp: t.toISOString(),
    });
  }

  return result;
}

module.exports = { getDpeValues, getValuesByElementIds, setDpeValue, getDpeHistory };
