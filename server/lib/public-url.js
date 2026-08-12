/**
 * Build public URLs for cloud portal, MikroTik fetch, and API callbacks.
 * Combines BASE_URL + BASE_PATH so /allvendo deployments resolve correctly.
 */
function getPublicBaseUrl(options = {}) {
  const basePath = String(options.basePath ?? process.env.BASE_PATH ?? '').replace(/\/$/, '');
  let baseUrl = String(options.baseUrl ?? process.env.BASE_URL ?? '').replace(/\/$/, '');

  if (!baseUrl) {
    return basePath || 'https://jmtechsolution.cloud/allvendo';
  }

  try {
    const parsed = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
    let path = parsed.pathname.replace(/\/$/, '');
    if (basePath) {
      if (!path || path === '/') path = basePath;
      else if (!path.endsWith(basePath)) path += basePath;
    }
    parsed.pathname = path || '';
    return (parsed.origin + parsed.pathname).replace(/\/$/, '');
  } catch {
    return (baseUrl + basePath).replace(/\/$/, '');
  }
}

function getPortalUrl(options = {}) {
  return `${getPublicBaseUrl(options)}/portal/`;
}

function getLoginHtmlUrl(siteId, options = {}) {
  return `${getPublicBaseUrl(options)}/mikrotik/login-${siteId}.html`;
}

function getWalledGardenHosts(options = {}) {
  const hosts = new Set([
    'jmtechsolution.cloud',
    '*.jmtechsolution.cloud',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ]);
  try {
    const base = getPublicBaseUrl(options);
    const parsed = new URL(base.includes('://') ? base : `https://${base}`);
    if (parsed.hostname) {
      hosts.add(parsed.hostname);
      const parts = parsed.hostname.split('.');
      if (parts.length >= 2) {
        hosts.add(`*.${parts.slice(-2).join('.')}`);
      }
    }
  } catch {}
  return [...hosts];
}

module.exports = {
  getPublicBaseUrl,
  getPortalUrl,
  getLoginHtmlUrl,
  getWalledGardenHosts
};
