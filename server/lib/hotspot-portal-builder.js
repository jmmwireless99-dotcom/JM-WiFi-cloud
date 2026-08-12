/**
 * Build complete MikroTik hotspot/ file set from templates in mikrotik/hotspot/.
 */
const fs = require('fs');
const path = require('path');
const { getPublicBaseUrl } = require('./public-url');

const TEMPLATE_DIR = path.join(__dirname, '../../mikrotik/hotspot');

const TEMPLATE_FILES = [
  'portal.css',
  'portal.js',
  'login.html',
  'alogin.html',
  'logout.html',
  'status.html',
  'error.html',
  'redirect.html'
];

function resolveDomain(options = {}) {
  try {
    return new URL(getPublicBaseUrl(options)).hostname || 'jmtechsolution.cloud';
  } catch {
    return 'jmtechsolution.cloud';
  }
}

function applyVars(content, vars) {
  let out = content;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

/**
 * @param {string} siteId
 * @param {object} [options]
 * @returns {Record<string, string>} paths like hotspot/login.html → content
 */
function buildHotspotFileSet(siteId, options = {}) {
  const apiBase = options.apiBase || `${getPublicBaseUrl(options)}/api`;
  const domain = options.domain || resolveDomain(options);
  const vars = {
    SITE_ID: siteId,
    API_BASE: apiBase,
    DOMAIN: domain
  };

  const files = {};
  for (const name of TEMPLATE_FILES) {
    const src = path.join(TEMPLATE_DIR, name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing hotspot template: ${src}`);
    }
    const content = applyVars(fs.readFileSync(src, 'utf8'), vars);
    files[`hotspot/${name}`] = content;
  }
  return files;
}

/** @deprecated use buildHotspotFileSet — kept for server route */
function buildMikrotikLoginHtml(siteId, options = {}) {
  return buildHotspotFileSet(siteId, options)['hotspot/login.html'];
}

function listHotspotTemplateFiles() {
  return TEMPLATE_FILES.map((f) => `hotspot/${f}`);
}

module.exports = {
  buildHotspotFileSet,
  buildMikrotikLoginHtml,
  listHotspotTemplateFiles,
  TEMPLATE_DIR
};
