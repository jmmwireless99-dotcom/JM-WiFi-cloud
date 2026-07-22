require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const vendoRoutes = require('./routes/vendo');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, '../admin');
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API
app.use('/api', apiRoutes);
app.use('/api/vendo', vendoRoutes);

// MikroTik captive portal (hotspot login page)
app.use('/hotspot', express.static(path.join(__dirname, '../portal')));
app.use('/portal', express.static(path.join(__dirname, '../portal')));

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(SITE_DIR, 'login.html'));
});

// Main dashboard — jmtechsolution.cloud monitoring portal
app.use('/dashboard', express.static(SITE_DIR));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'JM Tech Solution Cloud',
    domain: 'jmtechsolution.cloud',
    version: '1.0.0'
  });
});

// Root → login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Legacy /admin redirect
app.get('/admin', (req, res) => res.redirect('/dashboard/'));
app.get('/admin/*', (req, res) => res.redirect('/dashboard/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JM Tech Solution Cloud running on port ${PORT}`);
  console.log(`Login:    ${BASE_URL}/login`);
  console.log(`Dashboard: ${BASE_URL}/dashboard/`);
  console.log(`Hotspot:  ${BASE_URL}/hotspot/`);
});
