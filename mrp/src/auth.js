import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

export function isManagerRole(role) {
  return role === 'admin' || role === 'staff';
}

/** Portal managers + vendo may-ari (full gas admin for their boards) */
export function isVendoAdminRole(role) {
  return isManagerRole(role) || role === 'vendo_owner';
}

/** Marketplace seller or portal manager */
export function isStoreSellerRole(role) {
  return isManagerRole(role) || role === 'store_seller';
}

/** Marketplace buyer */
export function isStoreBuyerRole(role) {
  return role === 'store_buyer';
}

export async function authenticate(username, password) {
  const raw = String(username || '').trim();
  const p = String(password || '');
  if (!raw || !p) return null;

  if (raw === process.env.ADMIN_USER && p === process.env.ADMIN_PASSWORD) {
    return { sub: raw, role: 'admin', displayName: 'Admin' };
  }

  const u = raw.toLowerCase();

  const { rows: staffRows } = await pool.query(
    'SELECT * FROM staff_accounts WHERE username = $1 AND is_active',
    [u]
  );
  if (staffRows[0]) {
    if (!(await bcrypt.compare(p, staffRows[0].password_hash))) return null;
    return {
      sub: u,
      role: 'staff',
      staffId: staffRows[0].id,
      displayName: staffRows[0].display_name || u,
    };
  }

  // Vendo owner (may-ari) — SoftAP-style cloud admin for their MAIN boards
  try {
    const { rows: ownerRows } = await pool.query(
      'SELECT * FROM vendo_owners WHERE username = $1 AND is_active',
      [u]
    );
    if (ownerRows[0]) {
      if (!(await bcrypt.compare(p, ownerRows[0].password_hash))) return null;
      return {
        sub: u,
        role: 'vendo_owner',
        ownerId: ownerRows[0].id,
        displayName: ownerRows[0].display_name || u,
      };
    }
  } catch {
    /* table may not exist yet before migration */
  }

  // Marketplace seller
  try {
    const { rows: sellerRows } = await pool.query(
      'SELECT * FROM store_sellers WHERE username = $1 AND is_active',
      [u]
    );
    if (sellerRows[0]) {
      if (!(await bcrypt.compare(p, sellerRows[0].password_hash))) return null;
      return {
        sub: u,
        role: 'store_seller',
        sellerId: sellerRows[0].id,
        displayName: sellerRows[0].shop_name || sellerRows[0].display_name || u,
      };
    }
  } catch {
    /* table may not exist yet */
  }

  // Marketplace buyer (cliente)
  try {
    const { rows: buyerRows } = await pool.query(
      'SELECT * FROM store_buyers WHERE username = $1 AND is_active',
      [u]
    );
    if (buyerRows[0]) {
      if (!(await bcrypt.compare(p, buyerRows[0].password_hash))) return null;
      return {
        sub: u,
        role: 'store_buyer',
        buyerId: buyerRows[0].id,
        displayName: buyerRows[0].display_name || u,
      };
    }
  } catch {
    /* table may not exist yet */
  }

  // Forex trading client — own login, assigned strategies (username or Gmail email)
  try {
    const { rows: fxRows } = await pool.query(
      `SELECT * FROM forex_clients
        WHERE is_active AND (username = $1 OR LOWER(email) = $1)`,
      [u]
    );
    if (fxRows[0]) {
      if (!(await bcrypt.compare(p, fxRows[0].password_hash))) return null;
      const loginId = fxRows[0].email || fxRows[0].username;
      return {
        sub: loginId,
        role: 'forex_client',
        forexClientId: fxRows[0].id,
        displayName: fxRows[0].display_name || loginId,
      };
    }
  } catch {
    /* table may not exist yet */
  }

  const { rows } = await pool.query(
    `SELECT c.*,
            COALESCE(array_agg(a.barangay_id) FILTER (WHERE a.barangay_id IS NOT NULL), '{}') AS barangay_ids
       FROM client_accounts c
       LEFT JOIN client_barangay_access a ON a.client_id = c.id
      WHERE c.username = $1 AND c.is_active
      GROUP BY c.id`,
    [u]
  );
  if (!rows[0]) return null;
  if (!(await bcrypt.compare(p, rows[0].password_hash))) return null;

  return {
    sub: u,
    role: 'client',
    clientId: rows[0].id,
    displayName: rows[0].display_name || u,
    barangayIds: rows[0].barangay_ids.map(Number),
  };
}

export function signToken(user) {
  const {
    sub,
    role,
    clientId,
    staffId,
    ownerId,
    sellerId,
    buyerId,
    forexClientId,
    displayName,
    barangayIds,
  } = user;
  return jwt.sign(
    {
      sub,
      role,
      clientId,
      staffId,
      ownerId,
      sellerId,
      buyerId,
      forexClientId,
      displayName,
      barangayIds,
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function requireAuth(req, res, next) {
  const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

/** Full portal management (admin + staff) */
export function requireAdmin(req, res, next) {
  if (!isManagerRole(req.user?.role)) return res.status(403).json({ error: 'admin only' });
  next();
}

/** Gasoline vendo admin UI — managers or vendo owner */
export function requireVendoAdmin(req, res, next) {
  if (!isVendoAdminRole(req.user?.role)) {
    return res.status(403).json({ error: 'vendo admin only' });
  }
  next();
}

/** Marketplace seller dashboard — managers or store_seller */
export function requireStoreSeller(req, res, next) {
  if (!isStoreSellerRole(req.user?.role)) {
    return res.status(403).json({ error: 'store seller only' });
  }
  next();
}

/** Marketplace buyer (cliente) */
export function requireStoreBuyer(req, res, next) {
  if (!isStoreBuyerRole(req.user?.role)) {
    return res.status(403).json({ error: 'store buyer only' });
  }
  next();
}

/** Forex trading platform client */
export function isForexClientRole(role) {
  return role === 'forex_client';
}

export function requireForexClient(req, res, next) {
  if (!isForexClientRole(req.user?.role)) {
    return res.status(403).json({ error: 'forex client only' });
  }
  next();
}

export function forexClientId(req) {
  if (req.user?.role === 'forex_client') return Number(req.user.forexClientId) || 0;
  return 0;
}

/** Super admin only — env admin account; manages staff accounts */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'super admin only' });
  next();
}

/** CCTV playback — Super Admin only (staff / client viewers = live only) */
export function canPlayback(user) {
  return user?.role === 'admin';
}

export function requirePlayback(req, res, next) {
  if (!canPlayback(req.user)) {
    return res.status(403).json({ error: 'playback: admin only (staff/viewers = live view)' });
  }
  next();
}

/** null = full access (admin/staff); number = vendo_owners.id */
export function vendoOwnerScope(req) {
  if (isManagerRole(req.user?.role)) return null;
  if (req.user?.role === 'vendo_owner') return Number(req.user.ownerId) || 0;
  return -1;
}

/** null = full access (admin/staff); number = store_sellers.id */
export function storeSellerScope(req) {
  if (isManagerRole(req.user?.role)) return null;
  if (req.user?.role === 'store_seller') return Number(req.user.sellerId) || 0;
  return -1;
}

/** store_buyers.id for buyer role; 0 if missing */
export function storeBuyerId(req) {
  if (req.user?.role === 'store_buyer') return Number(req.user.buyerId) || 0;
  return 0;
}

/** null = full access (admin/staff); array = barangay ids for client viewers */
export function clientBarangayIds(req) {
  if (isManagerRole(req.user?.role)) return null;
  return (req.user?.barangayIds || []).map(Number);
}

export function hasBarangayAccess(req, barangayId) {
  const allowed = clientBarangayIds(req);
  if (allowed === null) return true;
  return allowed.includes(Number(barangayId));
}

export function filterGeoForClient(geo, barangayIds) {
  const allowed = new Set(barangayIds.map(Number));
  const barangays = geo.barangays.filter(b => allowed.has(b.id));
  const municipalityIds = new Set(barangays.map(b => b.municipality_id));
  const municipalities = geo.municipalities.filter(m => municipalityIds.has(m.id));
  const cityIds = new Set(municipalities.map(m => m.city_id));
  const cities = geo.cities.filter(c => cityIds.has(c.id));
  const provinceIds = new Set(cities.map(c => c.province_id));
  const provinces = geo.provinces.filter(p => provinceIds.has(p.id));
  const counts = Object.fromEntries(
    Object.entries(geo.counts || {}).filter(([id]) => allowed.has(Number(id)))
  );
  return { provinces, cities, municipalities, barangays, counts };
}
