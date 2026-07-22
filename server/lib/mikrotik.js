/**
 * MikroTik RouterOS REST helpers for JM WiFi Cloud Hotspot.
 * Pause/resume mode: do NOT set wall-clock limit-uptime — cloud owns remaining time.
 */
async function mtFetch(site, path, { method = 'GET', body } = {}) {
  const host = site.mikrotik_host;
  const user = site.mikrotik_user || 'admin';
  const pass = site.mikrotik_pass;
  if (!host || !pass) return { manual: true, error: 'No MikroTik credentials' };

  const url = `https://${host}/rest${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { error: data || text, status: res.status };
    return { success: true, data };
  } catch (err) {
    clearTimeout(timeout);
    return { error: err.message };
  }
}

/**
 * Create/update hotspot user for pause-resume sessions.
 * No limit-uptime (validity none) — time is tracked in cloud.
 */
async function createHotspotUser(site, macAddress, username, password, minutes, opts = {}) {
  const host = site.mikrotik_host;
  const pass = site.mikrotik_pass;
  const profile = opts.profileName || site.hotspot_profile || 'jmwifi-pause';

  if (!host || !pass) {
    console.log(`[MikroTik] No credentials for site ${site.id}, manual login`);
    return { manual: true, username, password, profile, pause_mode: true };
  }

  const body = {
    name: username,
    password: password,
    profile,
    comment: `JM-WiFi pause ${macAddress || ''} rem=${minutes}m`.trim()
  };

  // Pause mode: no wall-clock limit-uptime
  if (opts.forceUptimeLimit && minutes > 0) {
    body['limit-uptime'] = `${minutes}m`;
  }

  const result = await mtFetch(site, '/ip/hotspot/user', { method: 'PUT', body });
  if (result.success) {
    console.log(`[MikroTik] User ${username} profile=${profile} on ${host}`);
    return { success: true, username, password, minutes, profile, pause_mode: true };
  }

  // Try PATCH existing user
  const patch = await mtFetch(site, `/ip/hotspot/user/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body
  });
  if (patch.success) {
    return { success: true, username, password, minutes, profile, pause_mode: true, updated: true };
  }

  console.error(`[MikroTik] API error:`, result.error || patch.error);
  return {
    manual: true,
    username,
    password,
    profile,
    pause_mode: true,
    error: result.error || patch.error
  };
}

async function ensurePauseProfile(site, profile = {}) {
  const name = profile.name || 'jmwifi-pause';
  const body = {
    name,
    'shared-users': String(profile.shared_users || 1),
    'rate-limit': profile.rate_limit || '2M/5M',
    'keepalive-timeout': profile.keepalive_timeout || '2m',
    'idle-timeout': profile.idle_timeout || 'none',
    'status-autorefresh': '1m',
    'add-mac-cookie': profile.mac_cookie === 0 ? 'no' : 'yes',
    'mac-cookie-timeout': '1d',
    'transparent-proxy': profile.transparent_proxy ? 'yes' : 'no'
  };

  const put = await mtFetch(site, '/ip/hotspot/user/profile', { method: 'PUT', body });
  if (put.success) return { success: true, name, created: true };
  const patch = await mtFetch(site, `/ip/hotspot/user/profile/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body
  });
  if (patch.success) return { success: true, name, updated: true };
  return { manual: true, name, script: buildProfileScript(profile), error: put.error || patch.error };
}

function buildProfileScript(profile = {}) {
  const name = profile.name || 'jmwifi-pause';
  return [
    `/ip hotspot user profile`,
    `add name=${name} shared-users=${profile.shared_users || 1} rate-limit="${profile.rate_limit || '2M/5M'}" keepalive-timeout=${profile.keepalive_timeout || '2m'} idle-timeout=${profile.idle_timeout || 'none'} add-mac-cookie=yes mac-cookie-timeout=1d transparent-proxy=no comment="JM WiFi pause — no validity"`
  ].join('\n');
}

function buildServerScript(server = {}, cloudUrl = 'https://jmtechsolution.cloud/allvendo') {
  const name = server.name || 'JMWIFI';
  const vlan = server.vlan_id || 10;
  const hs = server.hs_address || '10.10.10.1';
  const html = server.html_directory || 'hotspot';
  const loginBy = server.login_by || 'http-pap,mac-cookie';
  return `; JM WiFi Cloud VLAN Hotspot — ${name}
; Mixed captive portal (MikroTik hotspot + cloud)
:local cloudUrl "${cloudUrl}"
/ip hotspot profile
add name=jmwifi hotspot-address=${hs} html-directory=${html} login-by=${loginBy} open-status-page=http-login status-autorefresh=30s
/ip hotspot walled-garden
add dst-host=jmtechsolution.cloud
add dst-host=*.jmtechsolution.cloud
/ip hotspot
add name=${name} interface=bridge-hotspot address-pool=hotspot-pool profile=jmwifi disabled=no
:put ("Portal: " . $cloudUrl . "/portal/?site_id=YOUR_SITE_ID")
; VLAN id hint: ${vlan}
`;
}

module.exports = {
  createHotspotUser,
  ensurePauseProfile,
  buildProfileScript,
  buildServerScript,
  mtFetch
};
