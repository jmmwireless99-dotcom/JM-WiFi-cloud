require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { buildMikrotikLoginHtml } = require('./lib/login-html');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const emptyBottleAdminRoutes = require('./routes/empty-bottle-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

// Ensure DB exists, then migrate
const dbPath = path.join(__dirname, 'db', 'jmwifi.db');
const root = path.join(__dirname, '..');
if (!fs.existsSync(dbPath)) {
  console.log('Database not found — initializing...');
  require('child_process').execSync('node server/db/init.js', {
    cwd: root,
    stdio: 'inherit'
  });
} else {
  require('./db/migrate');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Expose base path to frontends
app.get(`${BASE_PATH}/config.js`, (req, res) => {
  res.type('application/javascript').send(
    `window.JM_BASE_PATH=${JSON.stringify(BASE_PATH)};window.JM_API_BASE=${JSON.stringify(BASE_PATH + '/api')};`
  );
});

app.use(`${BASE_PATH}/api`, apiRoutes);
app.use(`${BASE_PATH}/api/admin`, adminRoutes);
app.use(`${BASE_PATH}/api/empty-bottle/admin`, emptyBottleAdminRoutes);

app.use(`${BASE_PATH}/portal`, express.static(path.join(__dirname, '../portal')));
app.use(`${BASE_PATH}/admin`, express.static(path.join(__dirname, '../admin')));
app.use(`${BASE_PATH}/empty-bottle`, express.static(path.join(__dirname, '../empty-bottle')));

// Site-specific MikroTik login.html (for /tool fetch upload)
app.get(`${BASE_PATH}/mikrotik/login-:siteId.html`, (req, res) => {
  const { getPublicBaseUrl } = require('./lib/public-url');
  res.set('X-JM-Portal-Build', 'full-v2');
  res.type('html').send(buildMikrotikLoginHtml(req.params.siteId, {
    apiBase: `${getPublicBaseUrl()}/api`
  }));
});

app.get(`${BASE_PATH}/health`, (req, res) => {
  res.json({
    status: 'ok',
    service: 'JM WiFi Cloud — All Vendo',
    version: '2.0.0',
    base_path: BASE_PATH || '/',
    domain: process.env.BASE_URL || 'jmtechsolution.cloud'
  });
});

// Also serve without prefix when BASE_PATH empty or for direct port access
if (BASE_PATH) {
  app.get(['/', BASE_PATH, `${BASE_PATH}/`], (req, res) => {
    res.redirect(`${BASE_PATH}/admin/`);
  });
} else {
  app.get('/', (req, res) => {
    res.redirect('/admin/');
  });
}

app.listen(PORT, '0.0.0.0', () => {
  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  console.log(`JM WiFi Cloud (All Vendo) on port ${PORT}`);
  console.log(`  Admin:  ${base}${BASE_PATH}/admin/`);
  console.log(`  Empty Bottle: ${base}${BASE_PATH}/empty-bottle/`);
  console.log(`  Portal: ${base}${BASE_PATH}/portal/`);
  console.log(`  API:    ${base}${BASE_PATH}/api/`);
});
