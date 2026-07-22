/**
 * MikroTik hotspot login.html — RouterOS expands $(mac), $(link-login-only), etc.
 * before the browser runs this script.
 */
function buildMikrotikLoginHtml(siteId, portalUrl) {
  const cloud = String(portalUrl || '').replace(/\/?$/, '/');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JM WiFi</title>
  <meta http-equiv="refresh" content="2; url=${cloud}?site_id=${siteId}&amp;mac=$(mac)&amp;ip=$(ip)&amp;link-login-only=$(link-login-only)&amp;link-orig=$(link-orig-esc)&amp;error=$(error)">
  <style>
    body{margin:0;font-family:system-ui,sans-serif;background:#0b6e4f;color:#fff;display:grid;place-items:center;min-height:100vh}
    .box{text-align:center;padding:24px}
    .brand{font-size:2rem;font-weight:800;letter-spacing:-.04em}
    p{opacity:.9}
  </style>
  <script>
    (function () {
      var SITE_ID = ${JSON.stringify(siteId)};
      var CLOUD = ${JSON.stringify(cloud)};
      var q = '?site_id=' + encodeURIComponent(SITE_ID);
      var mac = '$(mac)';
      if (mac && mac.indexOf('$(') === -1) q += '&mac=' + encodeURIComponent(mac);
      var ip = '$(ip)';
      if (ip && ip.indexOf('$(') === -1) q += '&ip=' + encodeURIComponent(ip);
      var linkLogin = '$(link-login-only)';
      if (linkLogin && linkLogin.indexOf('$(') === -1) q += '&link-login-only=' + encodeURIComponent(linkLogin);
      var linkOrig = '$(link-orig-esc)';
      if (linkOrig && linkOrig.indexOf('$(') === -1) q += '&link-orig=' + encodeURIComponent(linkOrig);
      var err = '$(error)';
      if (err && err.indexOf('$(') === -1) q += '&error=' + encodeURIComponent(err);
      setTimeout(function () { location.replace(CLOUD + q); }, 120);
    })();
  </script>
</head>
<body>
  <div class="box">
    <div class="brand">JM WiFi</div>
    <p>Connecting to secure portal…</p>
  </div>
</body>
</html>`;
}

module.exports = { buildMikrotikLoginHtml };
