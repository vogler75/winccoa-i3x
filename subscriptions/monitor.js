'use strict';

/**
 * subscriptions/monitor.js — dpConnect-based monitoring.
 *
 * Each monitored ObjectInstance may span one or many DPEs (scalar vs struct).
 * For a struct object we open a single dpConnect that lists every leaf DPE,
 * keep the most recent value per leaf in memory, and emit a single
 * SyncUpdate carrying the assembled nested value on any change.
 */

const { WinccoaManager } = require('winccoa-manager');
const { mapQuality } = require('../utils/quality');
const { getObjectValueInfo, collectDpeLeaves } = require('../mapping/hierarchy');
const manager = require('./manager');

const winccoa = new WinccoaManager();

/**
 * Open a subscription-monitor for an elementId. Returns a handle that can be
 * passed to `disconnect()` later, or null if the element is not monitorable
 * (unknown, folder, or resolves to zero DPEs).
 */
async function connect(subscriptionId, elementId) {
  const info = await getObjectValueInfo(elementId);
  if (!info) return null;

  const leaves = await collectDpeLeaves(info);
  if (leaves.length === 0) return null;

  // Compose the dpConnect DPE list: for each leaf we watch _value, _invalid, _stime.
  const keys = [];
  for (const { dpe } of leaves) {
    keys.push(`${dpe}:_online.._value`);
    keys.push(`${dpe}:_online.._invalid`);
    keys.push(`${dpe}:_online.._stime`);
  }

  // Per-leaf last-known VQTs (index matches `leaves`).
  const lastVqts = leaves.map(() => ({ value: null, quality: 'GoodNoData', timestamp: null }));
  const lastValues = leaves.map(() => ({ value: null, relPath: '' }));
  for (let i = 0; i < leaves.length; i++) lastValues[i].relPath = leaves[i].relPath;

  function onChanged(changedNames, values, _type, error) {
    if (error) {
      console.error(`dpConnect error for ${elementId} (sub ${subscriptionId}):`, error);
      return;
    }
    // `values` is aligned with `keys`: 3 entries per leaf.
    for (let i = 0; i < leaves.length; i++) {
      const v = values[i * 3];
      const inv = values[i * 3 + 1];
      const st = values[i * 3 + 2];

      const noValue = v === null || v === undefined;
      let ts = null;
      if (st instanceof Date) ts = st.toISOString();
      else if (st != null) ts = new Date(st).toISOString();

      lastVqts[i] = {
        value: noValue ? null : v,
        quality: mapQuality(inv, noValue),
        timestamp: ts,
      };
      lastValues[i].value = noValue ? null : v;
    }
    const assembled = assemble(lastValues);
    const agg = aggregate(lastVqts);
    manager.pushUpdate(subscriptionId, elementId, {
      value: assembled,
      quality: agg.quality,
      timestamp: agg.timestamp,
    });
  }

  const connectId = winccoa.dpConnect(onChanged, keys, true);
  return connectId;
}

function assemble(lastValues) {
  if (lastValues.length === 1 && lastValues[0].relPath === '') return lastValues[0].value;
  const out = {};
  for (const { relPath, value } of lastValues) {
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

const RANK = { Good: 0, GoodNoData: 1, Uncertain: 2, Bad: 3 };
function aggregate(vqts) {
  let worst = 'Good';
  let latest = null;
  for (const v of vqts) {
    if ((RANK[v.quality] ?? 3) > (RANK[worst] ?? 0)) worst = v.quality;
    if (v.timestamp && (!latest || v.timestamp > latest)) latest = v.timestamp;
  }
  return { quality: worst, timestamp: latest || new Date().toISOString() };
}

function disconnect(connectId) {
  try {
    winccoa.dpDisconnect(connectId);
  } catch (exc) {
    console.warn('dpDisconnect failed for connectId', connectId, ':', exc);
  }
}

module.exports = { connect, disconnect };
