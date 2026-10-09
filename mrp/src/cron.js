// Expiration enforcement — every 5 min. Stations na may expires_at lang ang apektado
// (NULL expires_at = walang expiry, hindi kailanman ma-e-expire).
import cron from 'node-cron';
import { pool, audit } from './db.js';
import { sync, terminateSession } from './services/provisioner.js';
import { cleanupExpiredWifiPayUsers } from './services/wifiPay.js';

export function startCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { rows } = await pool.query(
        `UPDATE stations SET status='expired'
          WHERE status='active' AND expires_at IS NOT NULL AND expires_at <= now()
          RETURNING username`
      );
      if (rows.length === 0) return;
      await sync('cron', `expired: ${rows.map(r => r.username).join(',')}`);
      for (const { username } of rows) await terminateSession(username);
      await audit('cron', 'expire', { usernames: rows.map(r => r.username) });
      console.log(`[cron] expired ${rows.length} station(s)`);
    } catch (e) {
      console.error('[cron] error:', e.message);
    }
  });

  // Hide absolute 3-day validity: disable MikroTik users after valid_until
  cron.schedule('*/15 * * * *', async () => {
    try {
      const r = await cleanupExpiredWifiPayUsers();
      if (r.cleaned) console.log(`[cron] wifi-pay cleaned ${r.cleaned} expired user(s)`);
    } catch (e) {
      console.error('[cron] wifi-pay cleanup:', e.message);
    }
  });

  console.log('[cron] expiration checker scheduled (*/5m); wifi-pay cleanup (*/15m)');
}
