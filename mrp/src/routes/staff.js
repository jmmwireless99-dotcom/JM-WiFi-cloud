import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, audit } from '../db.js';
import { requireSuperAdmin } from '../auth.js';
import { allocateVpnIp, allocateStaffVpnUsername, generatePassword } from '../services/allocator.js';
import { sync, terminateSession, getActiveSessions } from '../services/provisioner.js';
import { HUB, SSTP_PORT } from '../config.js';

const r = Router();
r.use(requireSuperAdmin);

function toView(row, online) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: row.is_active,
    vpnEnabled: row.vpn_enabled,
    vpnUsername: row.vpn_username,
    vpnIp: row.vpn_ip,
    vpnOnline: row.vpn_username ? online?.has(row.vpn_username) || false : false,
    sstpServer: HUB(),
    sstpPort: SSTP_PORT(),
    created: row.created_at,
  };
}

function vpnSetupText(row) {
  return [
    `# JM TECH SOLUTION — Staff SSTP VPN`,
    `Server: ${HUB()}`,
    `Port: ${SSTP_PORT()}`,
    `Type: SSTP`,
    `Username: ${row.vpn_username}`,
    `Password: ${row.vpn_password}`,
    `Tunnel IP: ${row.vpn_ip}`,
    '',
    `# Windows: Settings → Network → VPN → Add VPN`,
    `#   VPN provider: Windows (built-in)`,
    `#   Connection name: JM TECH Staff`,
    `#   Server: ${HUB()}`,
    `#   VPN type: Secure Socket Tunneling Protocol (SSTP)`,
    `#   Username / password: gamitin ang VPN credentials sa itaas`,
  ].join('\n');
}

function validateUsername(u) {
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(u))
    return 'username: 3-32 chars, letters/numbers/dot/dash';
  return null;
}

async function usernameTaken(u) {
  const [staff, client, station] = await Promise.all([
    pool.query('SELECT 1 FROM staff_accounts WHERE username=$1', [u]),
    pool.query('SELECT 1 FROM client_accounts WHERE username=$1', [u]),
    pool.query('SELECT 1 FROM stations WHERE username=$1', [u]),
  ]);
  return staff.rowCount > 0 || client.rowCount > 0 || station.rowCount > 0;
}

async function provisionVpn(row) {
  const vpnUsername = row.vpn_username || await allocateStaffVpnUsername(row.username);
  const vpnPassword = row.vpn_password || generatePassword();
  const vpnIp = row.vpn_ip || await allocateVpnIp();
  const { rows } = await pool.query(
    `UPDATE staff_accounts
        SET vpn_enabled = true,
            vpn_username = $2,
            vpn_password = $3,
            vpn_ip = $4
      WHERE id = $1
      RETURNING *`,
    [row.id, vpnUsername, vpnPassword, vpnIp]
  );
  return rows[0];
}

r.get('/', async (_req, res) => {
  const [{ rows }, online] = await Promise.all([
    pool.query('SELECT * FROM staff_accounts ORDER BY username'),
    getActiveSessions(),
  ]);
  res.json(rows.map(row => toView(row, online)));
});

r.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM staff_accounts WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const online = await getActiveSessions();
  const row = rows[0];
  res.json({
    ...toView(row, online),
    vpnPassword: row.vpn_password || null,
    vpnSetup: row.vpn_username ? vpnSetupText(row) : null,
  });
});

r.post('/', async (req, res) => {
  // Default: portal viewer (live CCTV) without VPN. Admin can enable SSTP if needed.
  const { username, password, displayName = '', vpnEnabled = false } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  const err = validateUsername(u);
  if (err) return res.status(400).json({ error: err });
  if (!password || String(password).length < 8)
    return res.status(400).json({ error: 'password: minimum 8 characters' });
  if (u === String(process.env.ADMIN_USER || '').toLowerCase())
    return res.status(409).json({ error: 'username reserved' });
  if (await usernameTaken(u))
    return res.status(409).json({ error: 'username already exists' });

  const hash = await bcrypt.hash(String(password), 10);
  const { rows } = await pool.query(
    `INSERT INTO staff_accounts (username, password_hash, display_name, vpn_enabled)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [u, hash, String(displayName || '').trim(), !!vpnEnabled]
  );
  let row = rows[0];
  if (row.vpn_enabled) row = await provisionVpn(row);
  await sync(req.user.sub, `create staff ${u}`);
  await audit(req.user.sub, 'staff.create', { username: u, vpn: !!row.vpn_username });
  res.status(201).json({
    ...toView(row, new Map()),
    portalPassword: password,
    vpnPassword: row.vpn_password,
    vpnSetup: row.vpn_username ? vpnSetupText(row) : null,
  });
});

r.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const { rows: existing } = await pool.query('SELECT * FROM staff_accounts WHERE id=$1', [id]);
  if (!existing[0]) return res.status(404).json({ error: 'not found' });
  let row = existing[0];

  const sets = [];
  const vals = [];
  if (body.displayName !== undefined) {
    vals.push(String(body.displayName).trim());
    sets.push(`display_name = $${vals.length}`);
  }
  if (body.isActive !== undefined) {
    vals.push(!!body.isActive);
    sets.push(`is_active = $${vals.length}`);
  }
  if (body.vpnEnabled !== undefined) {
    vals.push(!!body.vpnEnabled);
    sets.push(`vpn_enabled = $${vals.length}`);
  }
  if (body.password) {
    if (String(body.password).length < 8)
      return res.status(400).json({ error: 'password: minimum 8 characters' });
    vals.push(await bcrypt.hash(String(body.password), 10));
    sets.push(`password_hash = $${vals.length}`);
  }
  if (sets.length) {
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE staff_accounts SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    row = rows[0];
  }

  if (body.regenerateVpnPassword) {
    const vpnPassword = generatePassword();
    const { rows } = await pool.query(
      'UPDATE staff_accounts SET vpn_password = $2 WHERE id = $1 RETURNING *',
      [id, vpnPassword]
    );
    row = rows[0];
  }

  if (row.vpn_enabled && !row.vpn_username) row = await provisionVpn(row);
  if (!row.vpn_enabled && row.vpn_username) {
    await terminateSession(row.vpn_username);
  }

  await sync(req.user.sub, `update staff ${row.username}`);
  const online = await getActiveSessions();
  await audit(req.user.sub, 'staff.update', { id, username: row.username });
  res.json({
    ...toView(row, online),
    vpnPassword: row.vpn_password || null,
    vpnSetup: row.vpn_username && row.vpn_enabled ? vpnSetupText(row) : null,
  });
});

r.delete('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM staff_accounts WHERE id=$1 RETURNING username, vpn_username',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  if (rows[0].vpn_username) await terminateSession(rows[0].vpn_username);
  await sync(req.user.sub, `delete staff ${rows[0].username}`);
  await audit(req.user.sub, 'staff.delete', { username: rows[0].username });
  res.json({ ok: true });
});

export default r;
