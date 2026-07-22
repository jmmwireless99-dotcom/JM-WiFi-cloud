require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
  const siteId = req.params.siteId;
  const cloud = (process.env.BASE_URL || 'https://jmtechsolution.cloud/allvendo').replace(/\/$/, '');
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JM WiFi</title>
  <style>
    body{margin:0;font-family:system-ui,sans-serif;background:#0b6e4f;color:#fff;display:grid;place-items:center;min-height:100vh}
    .box{text-align:center;padding:24px}
    .brand{font-size:2rem;font-weight:800;letter-spacing:-.04em}
    p{opacity:.9}
  </style>
  <script>
    (function () {
      var SITE_ID = ${JSON.stringify(siteId)};
      var CLOUD = ${JSON.stringify(cloud + '/portal/')};
      var q = location.search || '';
      if (q.indexOf('site_id=') === -1) {
        q += (q ? '&' : '?') + 'site_id=' + encodeURIComponent(SITE_ID);
      }
      setTimeout(function () { location.replace(CLOUD + q); }, 120);
    })();
  </script>
</head>
<body>
  <div class="box">
    <div class="brand">JM WiFi</div>
    <p>Connecting to secure portal…</p>
  </div>
</body>
</html>`;
  res.type('html').send(html);
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
