/**
 * SOCIAL Park (station 71) — canonical NVR channels D1–D30.
 * Display names are label-only (no IP in UI / DB name). Device LAN kept in lanIp for ops.
 *
 * D18 + D19 both map device .28 — keep both channels.
 * Extra direct Circle-In cams (.42/.43) are NOT in the viewer set.
 */

export const SOCIAL_STATION_ID = 71;
export const SOCIAL_NVR_LAN = '192.168.20.254';

/** @type {Record<number, { label: string, lanIp: string|null }>} */
export const SOCIAL_CHANNEL_NAMES = {
  1: { label: 'CIRCLE-OUTDOOR-1', lanIp: '192.168.20.14' },
  2: { label: 'CIRCLE-INDOOR-1', lanIp: '192.168.20.23' },
  3: { label: 'CIRCLE-OUTDOOR-2', lanIp: '192.168.20.12' },
  4: { label: 'CIRCLE-OUTDOOR-3', lanIp: '192.168.20.15' },
  5: { label: 'CIRCLE-OUTDOOR-4', lanIp: '192.168.20.13' },
  6: { label: 'CIRCLE-OUTDOOR-5', lanIp: '192.168.20.16' },
  7: { label: 'CSU-1', lanIp: '192.168.20.18' },
  8: { label: 'CSU-2', lanIp: '192.168.20.19' },
  9: { label: 'TOURISM-1', lanIp: '192.168.20.20' },
  10: { label: 'TOURISM-2', lanIp: '192.168.20.2' },
  11: { label: 'MINI PLAZA', lanIp: '192.168.20.21' },
  12: { label: '1ST GATE-1', lanIp: '192.168.20.22' },
  13: { label: 'TOWER-1', lanIp: '192.168.20.24' },
  14: { label: 'TOWER-2', lanIp: '192.168.20.25' },
  15: { label: 'PDRRMO-1', lanIp: '192.168.20.26' },
  16: { label: 'PDRRMO-2', lanIp: '192.168.20.27' },
  17: { label: 'RIZAL-1', lanIp: '192.168.20.29' },
  18: { label: '2ND GATE', lanIp: '192.168.20.28' },
  19: { label: 'CAPITOL SIDE-1', lanIp: '192.168.20.28' },
  20: { label: 'RIZAL-2', lanIp: '192.168.20.30' },
  21: { label: 'TOWER-3', lanIp: '192.168.20.31' },
  22: { label: 'CIRCLE INDOOR-3', lanIp: '192.168.20.32' },
  23: { label: 'CIRCLE INDOOR-2', lanIp: '192.168.20.33' },
  24: { label: 'RIZAL-3', lanIp: '192.168.20.34' },
  25: { label: '4RT GATE-4', lanIp: '192.168.20.35' },
  26: { label: '3RD GATE-1', lanIp: '192.168.20.37' },
  27: { label: '4RTH GATE-2', lanIp: '192.168.20.38' },
  28: { label: 'CAPITOL SIDE-2', lanIp: '192.168.20.39' },
  29: { label: '3RD GATE-2', lanIp: '192.168.20.40' },
  30: { label: 'RIZAL-4', lanIp: '192.168.20.41' },
};

/** @deprecated extras removed from viewer — kept empty so old imports do not re-add */
export const SOCIAL_DIRECT_CIRCLE_IN = {};

/** Preferred tab order (All is separate in the UI) */
export const SOCIAL_AREA_TAB_ORDER = [
  'CIRCLE OUTDOOR',
  'CIRCLE INDOOR',
  'CSU',
  'TOURISM',
  'MINI PLAZA',
  '1ST GATE',
  '2ND GATE',
  'TOWER',
  'PDRRMO',
  'RIZAL',
  'CAPITOL SIDE',
  '4TH GATE',
  '3RD GATE',
];

/** Display name only — never append IP for SOCIAL viewer/catalog. */
export function formatSocialCamName(label, _lanIp) {
  const L = String(label || '').trim();
  return L || 'UNKNOWN';
}

export function isCanonicalSocialChannel(ch) {
  const n = Number(ch);
  return Number.isFinite(n) && n >= 1 && n <= 30 && !!SOCIAL_CHANNEL_NAMES[n];
}

/**
 * Normalize a camera display name into an area tab key.
 * CIRCLE INDOOR / CIRCLE-INDOOR / Circle-In → CIRCLE INDOOR
 * 4RT GATE / 4RTH GATE → 4TH GATE
 */
export function areaGroupFromName(name) {
  let raw = String(name || '').trim();
  if (!raw) return 'OTHER';

  // Strip trailing device IP ( · 192… or -192…)
  raw = raw
    .replace(/\s*[·|]\s*\d{1,3}(?:\.\d{1,3}){3}\s*$/i, '')
    .replace(/[-\s]\d{1,3}(?:\.\d{1,3}){3}\s*$/i, '')
    .trim();

  const compact = raw.replace(/[-_\s]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

  if (/^CIRCLE\s*IN(?:DOOR)?(?:\s|$)/.test(compact) || /^CIRCLE\s*IN(?:DOOR)?-/.test(compact.replace(/ /g, '-'))) {
    return 'CIRCLE INDOOR';
  }
  if (/^CIRCLE[\s-]*IN(?:DOOR)?/i.test(raw) || /^CIRCLE[\s-]*IN[\s-]/i.test(raw)) {
    return 'CIRCLE INDOOR';
  }
  if (/^CIRCLE[\s-]*OUTDOOR/i.test(raw)) return 'CIRCLE OUTDOOR';

  if (/^CSU\b/i.test(compact)) return 'CSU';
  if (/^TOURISM\b/i.test(compact)) return 'TOURISM';
  if (/^MINI[\s-]*PLAZA/i.test(raw)) return 'MINI PLAZA';
  if (/^1ST[\s-]*GATE/i.test(raw)) return '1ST GATE';
  if (/^2ND[\s-]*GATE/i.test(raw)) return '2ND GATE';
  if (/^TOWER\b/i.test(compact)) return 'TOWER';
  if (/^PDRRMO\b/i.test(compact)) return 'PDRRMO';
  if (/^RIZAL\b/i.test(compact)) return 'RIZAL';
  if (/^CAPITOL[\s-]*SIDE/i.test(raw)) return 'CAPITOL SIDE';
  if (/^4R?T?H?[\s-]*GATE/i.test(raw) || /^4RT/i.test(raw)) return '4TH GATE';
  if (/^3RD[\s-]*GATE/i.test(raw)) return '3RD GATE';

  const generic = compact.replace(/[\s-]+\d+[A-Z]?$/, '').trim();
  return generic || 'OTHER';
}

export function channelFromRtspPath(path) {
  const m = String(path || '').match(/channel=(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function ipFromName(name) {
  const m = String(name || '').match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return m ? m[1] : null;
}
