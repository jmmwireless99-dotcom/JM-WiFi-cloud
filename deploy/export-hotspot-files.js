#!/usr/bin/env node
/**
 * Export built MikroTik hotspot/ files to disk (for manual WinBox upload or inspection).
 *
 * Usage:
 *   SITE_ID=84ae9f8f-... node deploy/export-hotspot-files.js
 *   SITE_ID=... OUT_DIR=./out node deploy/export-hotspot-files.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { buildHotspotFileSet } = require('../server/lib/hotspot-portal-builder');

const siteId = process.env.SITE_ID || 'demo-site-id';
const outDir = path.resolve(process.env.OUT_DIR || path.join(__dirname, '../out/hotspot'));

const files = buildHotspotFileSet(siteId);
fs.mkdirSync(outDir, { recursive: true });

for (const [remotePath, content] of Object.entries(files)) {
  const localPath = path.join(outDir, path.basename(remotePath));
  fs.writeFileSync(localPath, content, 'utf8');
  console.log(`Wrote ${localPath} (${content.length} bytes)`);
}

console.log(`\nUpload folder sa MikroTik: Files → hotspot/`);
console.log(`Or: Hotspot Server → Save & Push sa admin (auto upload)`);
