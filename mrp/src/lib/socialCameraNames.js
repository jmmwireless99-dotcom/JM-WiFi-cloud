/**
 * SOCIAL Park (station 71) — NVR channels D1–D30.
 * Display names come from the Dahua NVR ChannelTitle (see sync-social-nvr-names.mjs).
 * Do not seed/overwrite with hardcoded CIRCLE-OUTDOOR / CSU labels here.
 */

export const SOCIAL_STATION_ID = 71;
export const SOCIAL_NVR_LAN = '192.168.20.254';

/** @deprecated seed labels removed — names sync from NVR ChannelTitle */
export const SOCIAL_CHANNEL_NAMES = {};

/** @deprecated extras removed from viewer — kept empty so old imports do not re-add */
export const SOCIAL_DIRECT_CIRCLE_IN = {};

/** Preferred tab order when NVR names match these area prefixes (All is separate in the UI) */
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
  const L = String(label || '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return L || 'UNKNOWN';
}

export function isCanonicalSocialChannel(ch) {
  const n = Number(ch);
  return Number.isFinite(n) && n >= 1 && n <= 30;
}

/**
 * Normalize a camera display name into an area tab key.
 * Works with NVR ChannelTitle styles: CIRCLE-OUTDOOR-1, MINI_PLAZA, TOWER1, CAPITOL-2.
 */
export function areaGroupFromName(name) {
  let raw = String(name || '').trim();
  if (!raw) return 'OTHER';

  raw = raw
    .replace(/\s*[·|]\s*\d{1,3}(?:\.\d{1,3}){3}\s*$/i, '')
    .replace(/[-\s]\d{1,3}(?:\.\d{1,3}){3}\s*$/i, '')
    .trim();

  const spaced = raw.replace(/_/g, ' ').replace(/[-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = spaced.toUpperCase();

  if (/^CIRCLE\s*IN(?:DOOR)?(?:\s|$)/.test(compact)) return 'CIRCLE INDOOR';
  if (/^CIRCLE\s*OUTDOOR/.test(compact)) return 'CIRCLE OUTDOOR';
  if (/^CSU\b/.test(compact)) return 'CSU';
  if (/^TOURISM\b/.test(compact)) return 'TOURISM';
  if (/^MINI\s*PLAZA/.test(compact)) return 'MINI PLAZA';
  if (/^1ST\s*GATE/.test(compact)) return '1ST GATE';
  if (/^2ND\s*GATE/.test(compact)) return '2ND GATE';
  if (/^TOWER\b/.test(compact) || /^TOWER\d/.test(compact)) return 'TOWER';
  if (/^PDRRMO\b/.test(compact)) return 'PDRRMO';
  if (/^RIZAL\b/.test(compact)) return 'RIZAL';
  if (/^CAPITOL(?:\s*SIDE)?/.test(compact)) return 'CAPITOL SIDE';
  if (/^4(?:TH|RT|RTH)?\s*GATE/.test(compact) || /^4TH\s*GATE/.test(compact)) return '4TH GATE';
  if (/^3RD\s*GATE/.test(compact)) return '3RD GATE';

  const generic = compact.replace(/\s+\d+[A-Z]?$/, '').trim();
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
