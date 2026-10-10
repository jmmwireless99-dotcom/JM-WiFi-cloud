/** Parse optional map coordinates. Empty / invalid → null. */
export function parseCoord(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Returns { lat, lng } or throws Error with message. Both null = clear. */
export function parseLatLngPair(body = {}) {
  const hasLat = body.lat !== undefined;
  const hasLng = body.lng !== undefined;
  if (!hasLat && !hasLng) return undefined;
  const lat = parseCoord(body.lat);
  const lng = parseCoord(body.lng);
  if (lat === null && lng === null) return { lat: null, lng: null };
  if (lat === null || lng === null) {
    throw new Error('lat and lng required together (or both empty to clear)');
  }
  if (lat < -90 || lat > 90) throw new Error('lat must be -90…90');
  if (lng < -180 || lng > 180) throw new Error('lng must be -180…180');
  return { lat, lng };
}

export function coordsFromRow(row) {
  const lat = row.lat != null ? Number(row.lat) : null;
  const lng = row.lng != null ? Number(row.lng) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
  return { lat, lng };
}
