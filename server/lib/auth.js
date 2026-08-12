const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'jm-wifi-dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  if (hash.length !== check.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function signToken(operator) {
  return jwt.sign(
    { sub: operator.id, email: operator.email, role: operator.role, name: operator.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const operator = db.prepare(
      "SELECT id, email, name, role, status FROM operators WHERE id = ? AND status = 'active'"
    ).get(payload.sub);
    if (!operator) return res.status(401).json({ error: 'Invalid session' });
    req.operator = operator;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.operator || !roles.includes(req.operator.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  authAdmin,
  requireRole,
  JWT_SECRET
};
