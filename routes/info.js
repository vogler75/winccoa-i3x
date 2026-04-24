'use strict';

const express = require('express');
const { sendSuccess } = require('../utils/response');
const { version: serverVersion, name: serverName } = require('../package.json');

const router = express.Router();

const SPEC_VERSION = '1.0-beta';

const CAPABILITIES = {
  query:     { history: true },
  update:    { current: true, history: true },
  subscribe: { stream: true },
};

// GET /info — unauthenticated server info + capabilities.
router.get('/', (_req, res) => {
  sendSuccess(res, {
    specVersion: SPEC_VERSION,
    serverVersion,
    serverName,
    capabilities: CAPABILITIES,
  });
});

module.exports = router;
