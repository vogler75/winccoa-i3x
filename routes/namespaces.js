'use strict';

const express = require('express');
const { buildNamespaceList } = require('../mapping/namespaces');
const { sendError } = require('../utils/errors');

const router = express.Router();

// GET /namespaces
router.get('/', async (_req, res) => {
  try {
    const namespaces = await buildNamespaceList();
    res.json(namespaces);
  } catch (exc) {
    console.error('GET /namespaces failed:', exc);
    sendError(res, 500, 'Internal error', String(exc));
  }
});

module.exports = router;
