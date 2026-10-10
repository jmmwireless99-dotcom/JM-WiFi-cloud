import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import geoRouter from './routes/geo.js';
import stationsRouter from './routes/stations.js';
import camerasRouter from './routes/cameras.js';
import nvrsRouter from './routes/nvrs.js';
import serverRouter from './routes/server.js';
import dashboardRouter from './routes/dashboard.js';
import billingRouter from './routes/billing.js';
import clientsRouter from './routes/clients.js';
import staffRouter from './routes/staff.js';
import zerotierRouter from './routes/zerotier.js';
import gasolineRouter from './routes/gasoline.js';
import vendoRouter from './routes/vendo.js';
import hotspotRouter from './routes/hotspot.js';
import payRouter from './routes/pay.js';
import wifiPayRouter from './routes/wifiPay.js';
import settingsRouter, { createPaymongoWebhookRouter } from './routes/settings.js';
import storeRouter from './routes/store.js';
import storeOrdersRouter from './routes/storeOrders.js';
import forexRouter, { registerForexClient, loginForexClient, recordForexLogin } from './routes/forex.js';
import { authenticate, signToken, requireAuth } from './auth.js';
import { startCron } from './cron.js';
import { sync } from './services/provisioner.js';
import { runMigrations } from './migrate.js';
import { BASE_PATH } from './config.js';
import soscialUpdateRouter from './routes/soscialUpdate.js';
import socialKeysRouter from './routes/socialKeys.js';

const app = express();
const BASE = BASE_PATH();

// PayMongo webhook needs raw body for HMAC — mount BEFORE express.json()
app.use(
  `${BASE}/api/webhooks/paymongo`,
  express.raw({ type: 'application/json', limit: '1mb' }),
  createPaymongoWebhookRouter()
);

app.use(express.json({ limit: '8mb' })); // store image uploads (base64)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- auth ----
app.post(`${BASE}/api/login`, async (req, res) => {
  try {
    const user = await authenticate(req.body?.username, req.body?.password);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    if (user.role === 'forex_client') {
      await recordForexLogin(user.forexClientId, user.sub);
    }
    res.json({
      token: signToken(user),
      role: user.role,
      displayName: user.displayName,
      barangayIds: user.barangayIds || [],
      ownerId: user.ownerId || null,
      clientId: user.clientId || null,
      sellerId: user.sellerId || null,
      buyerId: user.buyerId || null,
      forexClientId: user.forexClientId || null,
      // CCTV: only Super Admin may open playback; staff/viewers = live only
      canPlayback: user.role === 'admin',
      canManageAccounts: user.role === 'admin',
    });
  } catch (e) {
    console.error('login failed:', e.message);
    res.status(500).json({ error: 'login failed' });
  }
});

// ---- routes ----
app.use(`${BASE}/api/geo`, requireAuth, geoRouter);
app.use(`${BASE}/api/dashboard`, requireAuth, dashboardRouter);
app.use(`${BASE}/api/stations`, requireAuth, stationsRouter);
app.use(`${BASE}/api/cameras`, requireAuth, camerasRouter);
app.use(`${BASE}/api/nvrs`, requireAuth, nvrsRouter);
app.use(`${BASE}/api/server`, requireAuth, serverRouter);
app.use(`${BASE}/api/clients`, requireAuth, clientsRouter);
app.use(`${BASE}/api/staff`, requireAuth, staffRouter);
app.use(`${BASE}/api/zerotier`, requireAuth, zerotierRouter);
app.use(`${BASE}/api/gasoline`, requireAuth, gasolineRouter);
app.use(`${BASE}/api/hotspot`, requireAuth, hotspotRouter);
app.use(`${BASE}/api/vendo`, vendoRouter); // ESP32 device API key auth
app.use(`${BASE}/api/pay`, payRouter); // public phone client (no API key)
app.use(`${BASE}/api/wifi-pay`, wifiPayRouter); // Social Park Buy Unli (public captive portal)
app.use(`${BASE}/api/soscial`, soscialUpdateRouter); // SOCIAL CCTV (key-gated cameras)
app.use(`${BASE}/api/social`, socialKeysRouter); // viewer keys + auth
app.use(`${BASE}/api/store`, storeOrdersRouter); // buyer checkout + orders (public register first)
app.use(`${BASE}/api/store`, storeRouter); // marketplace (public catalog + seller auth)
app.post(`${BASE}/api/forex/register`, registerForexClient);
app.post(`${BASE}/api/forex/login`, loginForexClient);
app.use(`${BASE}/api/forex`, requireAuth, forexRouter);
app.use(`${BASE}/api/settings`, requireAuth, settingsRouter);
app.use(`${BASE}/api/billing`, billingRouter);
app.get(`${BASE}/api/health`, (req, res) => res.json({ ok: true }));

const publicDir = path.join(__dirname, '../public');
// Client pay page: /pay/F0C0FD (site root; legacy /cctv still redirected)
app.get(`${BASE}/pay/:deviceId`, (req, res) => {
  res.sendFile(path.join(publicDir, 'pay.html'));
});

// SoftAP-style gasoline vendo admin (same look as ESP32 SoftAP)
app.get(`${BASE}/vendo-admin`, (_req, res) => {
  res.sendFile(path.join(publicDir, 'vendo-admin.html'));
});
app.get(`${BASE}/gas-admin`, (_req, res) => {
  res.redirect(302, `${BASE || ''}/vendo-admin`);
});

// Marketplace storefront (Shopee/Lazada-style)
app.get(`${BASE}/shop`, (_req, res) => {
  res.sendFile(path.join(publicDir, 'shop.html'));
});
app.get(`${BASE}/shop/u/:username`, (_req, res) => {
  res.sendFile(path.join(publicDir, 'shop.html'));
});
app.get(`${BASE}/store`, (_req, res) => {
  res.redirect(302, `${BASE || ''}/shop`);
});

// Forex trading client portal
app.get(`${BASE}/forex`, (_req, res) => {
  res.sendFile(path.join(publicDir, 'forex.html'));
});

// SOCIAL Park mobile CCTV PWA — key gate; /social (canonical) + /soscial (legacy)
const sendSoscialApp = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(publicDir, 'soscial', 'index.html'));
};
app.get(`${BASE}/social`, sendSoscialApp);
app.get(`${BASE}/social/`, sendSoscialApp);
app.get(`${BASE}/social/v/:id`, sendSoscialApp);
app.get(`${BASE}/social/view/:id`, sendSoscialApp);
app.get(`${BASE}/soscial`, sendSoscialApp);
app.get(`${BASE}/soscial/v/:id`, sendSoscialApp);
app.get(`${BASE}/soscial/view/:id`, sendSoscialApp);
app.get(`${BASE}/social/download`, (_req, res) => {
  res.sendFile(path.join(publicDir, 'soscial', 'download.html'));
});
// Static assets for /social/* (same files as /soscial)
app.use(`${BASE}/social`, express.static(path.join(publicDir, 'soscial'), {
  maxAge: '1h',
  etag: true,
  setHeaders(res, filePath) {
    if (String(filePath).endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

// Forced APK/ZIP download (mobile browsers often need Content-Disposition)
function sendDownload(res, fileName, downloadName, contentType) {
  const filePath = path.join(publicDir, 'soscial', fileName);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'file not found' });
  });
}
const apkHandler = (_req, res) => {
  sendDownload(res, 'soscial-park-cctv.apk', 'soscial-park-cctv.apk', 'application/vnd.android.package-archive');
};
const tvApkHandler = (_req, res) => {
  // Same universal APK (phone + Leanback TV); alternate filename for TV sideload links
  sendDownload(res, 'soscial-park-cctv.apk', 'soscial-park-cctv-tv.apk', 'application/vnd.android.package-archive');
};
const zipHandler = (_req, res) => {
  sendDownload(res, 'soscial-park-cctv.zip', 'soscial-park-cctv.zip', 'application/zip');
};
app.get(`${BASE}/soscial.apk`, apkHandler);
app.get(`${BASE}/soscial-tv.apk`, tvApkHandler);
app.get(`${BASE}/soscial/download.apk`, apkHandler);
app.get(`${BASE}/soscial/tv.apk`, tvApkHandler);
app.get(`${BASE}/soscial/soscial-park-cctv.apk`, apkHandler);
app.get(`${BASE}/soscial/soscial-park-cctv-tv.apk`, tvApkHandler);
app.get(`${BASE}/soscial.zip`, zipHandler);
app.get(`${BASE}/soscial/download.zip`, zipHandler);
app.get(`${BASE}/soscial/soscial-park-cctv.zip`, zipHandler);
app.get(`${BASE}/soscial/download`, (_req, res) => {
  res.sendFile(path.join(publicDir, 'soscial', 'download.html'));
});

// ---- panel (static) ----
app.use(BASE || '/', express.static(publicDir, {
  maxAge: '1h',
  etag: true,
  setHeaders(res, filePath) {
    if (String(filePath).endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    if (String(filePath).endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="soscial-park-cctv.apk"');
    }
  },
}));
if (BASE) {
  app.get(BASE, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

// Prevent unhandled async errors from crashing the process
app.use((err, _req, res, _next) => {
  console.error('unhandled route error:', err.message);
  res.status(500).json({ error: err.message || 'internal error' });
});

const port = Number(process.env.PORT || 8080);

process.on('unhandledRejection', err => {
  console.error('unhandled rejection:', err?.message || err);
});

app.listen(port, async () => {
  console.log(`JM TECH SOLUTION backend listening on :${port}${BASE ? ` (base ${BASE})` : ''}`);
  try {
    await runMigrations();
  } catch (e) {
    console.error('migration failed:', e.message);
  }
  try {
    await sync('system', 'startup'); // converge nft + secrets + mediamtx sa boot
  } catch (e) {
    console.error('startup sync failed:', e.message);
  }
  startCron();
});
