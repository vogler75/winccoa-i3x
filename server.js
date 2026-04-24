'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { basicAuth } = require('./auth');
const { version } = require('./package.json');

const namespacesRouter = require('./routes/namespaces');
const objectTypesRouter = require('./routes/object-types');
const relationshipTypesRouter = require('./routes/relationship-types');
const objectsRouter = require('./routes/objects');
const valuesRouter = require('./routes/values');
const historyRouter = require('./routes/history');
const subscriptionsRouter = require('./routes/subscriptions');

function createApp() {
  const app = express();

  // CORS
  if (config.cors.enabled) {
    app.use(cors({ origin: config.cors.origin }));
  }

  // Body parsing
  app.use(express.json());

  // Auth
  app.use(basicAuth);

  // Health check (unauthenticated — before basicAuth would block it, but we
  // apply auth globally so this is fine — auth.enabled=false for dev)
  const base = config.basePath;

  app.get(`${base}/health`, (_req, res) => {
    res.json({ status: 'ok', version });
  });

  // i3X routes
  app.use(`${base}/namespaces`, namespacesRouter);
  app.use(`${base}/objecttypes`, objectTypesRouter);
  app.use(`${base}/relationshiptypes`, relationshipTypesRouter);
  app.use(`${base}/objects`, objectsRouter);
  // Values and history are sub-paths of /objects — mount separately
  app.use(`${base}/objects`, valuesRouter);
  app.use(`${base}/objects`, historyRouter);
  app.use(`${base}/subscriptions`, subscriptionsRouter);

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 404, message: 'Not found' } });
  });

  return app;
}

module.exports = { createApp };
