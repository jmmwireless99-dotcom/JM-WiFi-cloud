export const HUB = () => process.env.HUB_DOMAIN || 'hub.example.com';
export const SSTP_PORT = () => Number(process.env.SSTP_PORT || 4443);
export const BASE_PATH = () => (process.env.BASE_PATH || '').replace(/\/$/, '');

export function hlsBase() {
  if (process.env.HLS_PUBLIC_URL) return process.env.HLS_PUBLIC_URL.replace(/\/$/, '');
  const scheme = process.env.HLS_SCHEME || 'http';
  const hub = HUB();
  if (process.env.HLS_PATH) {
    const p = process.env.HLS_PATH.startsWith('/') ? process.env.HLS_PATH : `/${process.env.HLS_PATH}`;
    return `${scheme}://${hub}${p}`.replace(/\/$/, '');
  }
  return `${scheme}://${hub}:${process.env.HLS_PORT || 8888}`;
}
