/**
 * Upload hotspot HTML files directly to MikroTik (FTP + fetch fallback).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;
const http = require('http');
const { buildMikrotikLoginHtml } = require('./login-html');
const { getLoginHtmlUrl, getPublicBaseUrl } = require('./public-url');

const execFileAsync = promisify(execFile);

function buildMinimalHtml(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function hotspotFileSet(siteId, options = {}) {
  const apiBase = options.apiBase || `${getPublicBaseUrl(options)}/api`;
  return {
    'hotspot/login.html': buildMikrotikLoginHtml(siteId, { ...options, apiBase }),
    'hotspot/alogin.html': buildMinimalHtml('JM WiFi', '<p>Connected. Redirecting…</p><meta http-equiv="refresh" content="1;url=$(link-redirect)">'),
    'hotspot/logout.html': buildMinimalHtml('JM WiFi', '<p>Logged out.</p><a href="$(link-login)">Login again</a>'),
    'hotspot/status.html': buildMinimalHtml('JM WiFi', '<p>Status</p><a href="$(link-login-only)">Login</a>'),
    'hotspot/redirect.html': buildMinimalHtml('JM WiFi', '<meta http-equiv="refresh" content="0;url=login.html">')
  };
}

async function uploadViaRest(site, remotePath, content) {
  const user = site.mikrotik_user || 'admin';
  const pass = site.mikrotik_pass;
  const host = site.mikrotik_host;
  const payload = Buffer.from(content, 'utf8');
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port: 80,
        path: `/rest/file/${remotePath}`,
        method: 'PUT',
        timeout: 90000,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': payload.length,
          Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, method: 'rest', path: remotePath });
          } else {
            resolve({ ok: false, error: raw || `HTTP ${res.statusCode}`, path: remotePath });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message, path: remotePath }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'REST upload timeout', path: remotePath });
    });
    req.write(payload);
    req.end();
  });
}

async function enableFtpService(api) {
  try {
    const svc = await api.call(['/ip/service/print', '?name=ftp']);
    if (svc.length && String(svc[0].disabled || '') === 'true') {
      await api.call(['/ip/service/set', `=.id=${svc[0]['.id']}`, '=disabled=no']);
    }
  } catch {}
}

async function uploadViaFtp(site, remotePath, content) {
  const tmp = path.join(os.tmpdir(), `jm-${Date.now()}-${path.basename(remotePath)}`);
  fs.writeFileSync(tmp, content, 'utf8');
  const user = site.mikrotik_user || 'admin';
  const pass = site.mikrotik_pass;
  const host = site.mikrotik_host;
  try {
    await execFileAsync('curl', [
      '-sS', '-T', tmp,
      '--ftp-pasv',
      '--ftp-create-dirs',
      '--connect-timeout', '20',
      '--max-time', '90',
      '-u', `${user}:${pass}`,
      `ftp://${host}/${remotePath}`
    ], { timeout: 100000 });
    return { ok: true, method: 'ftp', path: remotePath };
  } catch (err) {
    return { ok: false, error: err.message || String(err), path: remotePath };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function verifyLoginHtml(api, minSize = 4000) {
  const files = await api.call(['/file/print']);
  const hit = files.find((f) => {
    const name = String(f.name || '');
    return name === 'hotspot/login.html' || name.endsWith('/login.html');
  });
  const size = Number(hit?.size || 0);
  return { ok: !!hit && size >= minSize, size, name: hit?.name || null };
}

async function uploadViaFetch(api, siteId, options = {}) {
  const url = getLoginHtmlUrl(siteId, options);
  const attempts = [
    ['=mode=https', '=check-certificate=no'],
    ['=mode=http'],
    []
  ];
  for (const extra of attempts) {
    try {
      await api.call(['/tool/fetch', `=url=${url}`, '=dst-path=hotspot/login.html', ...extra]);
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const check = await verifyLoginHtml(api, 4000);
        if (check.ok) return { ok: true, size: check.size, url, method: 'fetch' };
      }
    } catch (e) {
      console.log('[mikrotik-files] fetch warn:', e.message, url);
    }
  }
  return { ok: false, error: `fetch failed: ${url}`, url };
}

/**
 * Upload captive portal files to MikroTik. Prefers direct FTP (no cloud fetch needed).
 */
async function uploadHotspotPortal(api, site, siteId, options = {}) {
  const files = hotspotFileSet(siteId, options);
  const steps = [];
  let loginResult = null;

  await enableFtpService(api);

  for (const [remotePath, content] of Object.entries(files)) {
    let uploaded = await uploadViaRest(site, remotePath, content);
    if (!uploaded.ok && remotePath === 'hotspot/login.html') {
      uploaded = await uploadViaFtp(site, remotePath, content);
    } else if (!uploaded.ok && remotePath !== 'hotspot/login.html') {
      uploaded = await uploadViaFtp(site, remotePath, content);
    }
    if (uploaded.ok) {
      steps.push(`${uploaded.method.toUpperCase()} uploaded ${remotePath} (${content.length} bytes)`);
      if (remotePath === 'hotspot/login.html') loginResult = uploaded;
    } else if (remotePath === 'hotspot/login.html') {
      steps.push(`REST/FTP failed for login.html: ${uploaded.error}`);
    }
  }

  let check = await verifyLoginHtml(api, 4000);
  if (!check.ok) {
    const fetch = await uploadViaFetch(api, siteId, options);
    if (fetch.ok) {
      steps.push(`fetch uploaded login.html (${fetch.size} bytes)`);
      loginResult = fetch;
    } else {
      steps.push(`fetch failed: ${fetch.error}`);
    }
    check = await verifyLoginHtml(api, 4000);
  }

  if (!check.ok) {
    return {
      ok: false,
      error: 'login.html wala o maliit sa MikroTik — walang captive portal sa http://10.0.0.1',
      size: check.size,
      steps
    };
  }

  return {
    ok: true,
    size: check.size,
    method: loginResult?.method || 'verified',
    steps: [...steps, `Verified hotspot/login.html (${check.size} bytes)`]
  };
}

async function resolveCloudIps(options = {}) {
  const ips = new Set();
  try {
    const host = new URL(getPublicBaseUrl(options)).hostname;
    for (const ip of await dns.resolve4(host)) ips.add(ip);
  } catch {}
  return [...ips];
}

async function ensureWalledGardenIps(api, options = {}, steps = []) {
  const ips = await resolveCloudIps(options);
  for (const ip of ips) {
    const found = await api.call(['/ip/hotspot/walled-garden/ip/print', `?dst-address=${ip}`]);
    if (!found.length) {
      try {
        await api.call([
          '/ip/hotspot/walled-garden/ip/add',
          `=dst-address=${ip}`,
          '=action=accept',
          '=comment=JM WiFi Cloud IP'
        ]);
        steps.push(`Walled garden IP ${ip}`);
      } catch (e) {
        steps.push(`WARN walled garden IP ${ip}: ${e.message}`);
      }
    }
  }
  return ips;
}

async function ensureHotspotRunning(api, hsName, steps = []) {
  const rows = await api.call(['/ip/hotspot/print', `?name=${hsName}`]);
  if (!rows.length) return false;
  const row = rows[0];
  if (String(row.disabled || '') === 'true') {
    await api.call(['/ip/hotspot/set', `=.id=${row['.id']}`, '=disabled=no']);
    steps.push(`Enabled hotspot ${hsName}`);
  }
  return true;
}

module.exports = {
  uploadHotspotPortal,
  verifyLoginHtml,
  ensureWalledGardenIps,
  ensureHotspotRunning,
  hotspotFileSet
};
