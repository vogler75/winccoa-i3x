'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  host: '0.0.0.0',
  port: 8080,
  basePath: '/i3x/v0',
  auth: { enabled: true },
  cns: {
    namespaceView: 'I3X_Namespaces',
    hierarchyViews: ['I3X_Hierarchy'],
  },
  defaultNamespaceUri: 'http://winccoa.local/default',
  cors: { enabled: true, origin: '*' },
};

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn('Failed to parse config.json, using defaults:', err.message);
    }
  }

  // Deep merge: file overrides defaults
  const cfg = Object.assign({}, DEFAULTS, fileConfig);
  cfg.auth = Object.assign({}, DEFAULTS.auth, fileConfig.auth || {});
  cfg.cns = Object.assign({}, DEFAULTS.cns, fileConfig.cns || {});
  cfg.cors = Object.assign({}, DEFAULTS.cors, fileConfig.cors || {});
  return cfg;
}

const config = loadConfig();
module.exports = config;
