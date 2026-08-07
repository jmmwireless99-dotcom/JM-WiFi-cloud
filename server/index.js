require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const vendoRoutes = require('./routes/vendo');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', apiRoutes);
app.use('/api/vendo', vendoRoutes);

// MikroTik captive portal (hotspot login page)
app.use('/portal', express.static(path.join(__dirname, '../portal')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'JM WiFi Cloud', version: '1.0.0' });
});

app.get('/', (req, res) => {
  res.json({
    service: 'JM WiFi Cloud API',
    portal: '/portal/',
    health: '/health'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JM WiFi Cloud running on port ${PORT}`);
  console.log(`API: ${process.env.BASE_URL || `http://localhost:${PORT}`}/api/`);
  console.log(`Hotspot portal: ${process.env.BASE_URL || `http://localhost:${PORT}`}/portal/`);
});
