'use strict';

/**
 * subscriptions/monitor.js
 *
 * dpConnect-based monitoring.
 * Connects to WinCC OA DPEs and forwards value changes to the subscription manager.
 */

const { WinccoaManager } = require('winccoa-manager');
const { mapQuality } = require('../utils/quality');
const manager = require('./manager');

const winccoa = new WinccoaManager();

/**
 * Connect to a DPE for a subscription.
 * Returns the connectId so it can be stored and later disconnected.
 *
 * @param {string} subscriptionId
 * @param {string} elementId   i3X elementId (used as the key in updates)
 * @param {string} dpeName     WinCC OA DPE address e.g. "Motor1.speed"
 * @returns {number} connectId
 */
function connect(subscriptionId, elementId, dpeName) {
  // We monitor the value + invalid flag + timestamp simultaneously.
  // dpConnect callback receives (names, values, type, error).

  const valueKey = `${dpeName}:_online.._value`;
  const invalidKey = `${dpeName}:_online.._invalid`;
  const stimeKey = `${dpeName}:_online.._stime`;

  function onChanged(names, values, _type, error) {
    if (error) {
      console.error(`dpConnect error for ${dpeName} (sub ${subscriptionId}):`, error);
      return;
    }

    // values[0] = _online.._value, values[1] = _online.._invalid, values[2] = _online.._stime
    const value = values[0];
    const invalid = values[1];
    const stime = values[2];

    const noValue = value === null || value === undefined;
    const quality = mapQuality(invalid, noValue);

    let timestamp = null;
    if (stime instanceof Date) {
      timestamp = stime.toISOString();
    } else if (stime != null) {
      timestamp = new Date(stime).toISOString();
    } else {
      timestamp = new Date().toISOString();
    }

    manager.pushUpdate(subscriptionId, elementId, {
      value: noValue ? null : value,
      quality,
      timestamp,
    });
  }

  const connectId = winccoa.dpConnect(onChanged, [valueKey, invalidKey, stimeKey], true);
  return connectId;
}

/**
 * Disconnect a dpConnect by its connectId.
 * @param {number} connectId
 */
function disconnect(connectId) {
  try {
    winccoa.dpDisconnect(connectId);
  } catch (exc) {
    console.warn('dpDisconnect failed for connectId', connectId, ':', exc);
  }
}

module.exports = { connect, disconnect };
