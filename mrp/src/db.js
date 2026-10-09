import pg from 'pg';
import 'dotenv/config';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function audit(actor, action, detail = {}) {
  await pool.query(
    'INSERT INTO audit_log (actor, action, detail) VALUES ($1,$2,$3)',
    [actor, action, JSON.stringify(detail)]
  );
}
