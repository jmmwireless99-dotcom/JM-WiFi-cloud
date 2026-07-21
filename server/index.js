require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

app.use('/portal', express.static(path.join(__dirname, '../portal')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'JM WiFi Cloud — All Vendo',
    version: '2.0.0',
    domain: process.env.BASE_URL || 'jmtechsolution.cloud'
  });
});

app.get('/', (req, res) => {
  res.redirect('/admin/');
});

app.listen(PORT, '0.0.0.0', () => {
  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  console.log(`JM WiFi Cloud (All Vendo) on port ${PORT}`);
  console.log(`  Admin:  ${base}/admin/`);
  console.log(`  Portal: ${base}/portal/`);
  console.log(`  API:    ${base}/api/`);
});
