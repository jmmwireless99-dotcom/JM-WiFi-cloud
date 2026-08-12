/**
 * Site scope helpers — Cloud Hotspot vs Empty Bottle modules share one DB.
 */
function ownedSitesSql(operator) {
  if (operator.role === 'admin') return { sql: '1=1', params: [] };
  return { sql: 'operator_id = ?', params: [operator.id] };
}

function moduleSitesSql(operator, moduleType = 'hotspot') {
  const owned = ownedSitesSql(operator);
  return {
    sql: `${owned.sql} AND COALESCE(module_type, 'hotspot') = ?`,
    params: [...owned.params, moduleType]
  };
}

function getOwnedSite(operator, siteId, moduleType = null) {
  if (operator.role === 'admin') {
    if (moduleType) {
      return db.prepare(
        'SELECT * FROM sites WHERE id = ? AND COALESCE(module_type, \'hotspot\') = ?'
      ).get(siteId, moduleType);
    }
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  }
  if (moduleType) {
    return db.prepare(
      'SELECT * FROM sites WHERE id = ? AND operator_id = ? AND COALESCE(module_type, \'hotspot\') = ?'
    ).get(siteId, operator.id, moduleType);
  }
  return db.prepare('SELECT * FROM sites WHERE id = ? AND operator_id = ?').get(siteId, operator.id);
}

const db = require('../db');

function publicSite(site) {
  if (!site) return null;
  const { mikrotik_pass, ...rest } = site;
  return { ...rest, has_mikrotik_pass: Boolean(mikrotik_pass) };
}

function siteIdsSubquery(operator, moduleType = 'hotspot') {
  if (operator.role === 'admin') {
    return {
      sql: "site_id IN (SELECT id FROM sites WHERE COALESCE(module_type, 'hotspot') = ?)",
      params: [moduleType]
    };
  }
  return {
    sql: "site_id IN (SELECT id FROM sites WHERE operator_id = ? AND COALESCE(module_type, 'hotspot') = ?)",
    params: [operator.id, moduleType]
  };
}

module.exports = {
  ownedSitesSql,
  moduleSitesSql,
  getOwnedSite,
  publicSite,
  siteIdsSubquery
};
