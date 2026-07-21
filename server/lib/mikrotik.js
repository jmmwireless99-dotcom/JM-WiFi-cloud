const db = require('../db');

/**
 * Create or update a hotspot user on MikroTik after voucher redemption.
 * Uses RouterOS REST API (v7+) or falls back to logging for manual setup.
 */
async function createHotspotUser(site, macAddress, username, password, minutes) {
  const host = site.mikrotik_host;
  const user = site.mikrotik_user || 'admin';
  const pass = site.mikrotik_pass;

  if (!host || !pass) {
    console.log(`[MikroTik] No credentials for site ${site.id}, user must login manually`);
    return { manual: true, username, password };
  }

  const uptime = `${minutes}m`;
  const url = `https://${host}/rest/ip/hotspot/user`;

  const body = {
    name: username,
    password: password,
    profile: site.hotspot_profile || 'jmwifi-user',
    'limit-uptime': uptime,
    comment: `JM-WiFi ${macAddress}`
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (res.ok) {
      console.log(`[MikroTik] User ${username} created on ${host}`);
      return { success: true, username, password, minutes };
    }

    const errText = await res.text();
    console.error(`[MikroTik] API error ${res.status}: ${errText}`);
    return { manual: true, username, password, error: errText };
  } catch (err) {
    console.error(`[MikroTik] Connection failed to ${host}:`, err.message);
    return { manual: true, username, password, error: err.message };
  }
}

module.exports = { createHotspotUser };
