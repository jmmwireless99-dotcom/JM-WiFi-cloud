const fs = require('fs');
const path = require('path');
const { getPublicBaseUrl } = require('./public-url');

function loadPortalCss() {
  const cssPath = path.join(__dirname, '../../portal/style.css');
  let css = fs.readFileSync(cssPath, 'utf8');
  css = css.replace(/@import[^;]+;/g, '');
  css += `
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.brand-name, #voucher-code, #coin-panel h2 { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
`;
  return css;
}

/**
 * Full captive portal page for MikroTik hotspot/login.html.
 * Shown at http://10.0.0.1 — RouterOS expands $(mac), $(link-login-only), etc.
 */
function buildMikrotikLoginHtml(siteId, options = {}) {
  const apiBase = options.apiBase || `${getPublicBaseUrl(options)}/api`;
  let domain = 'jmtechsolution.cloud';
  try {
    domain = new URL(getPublicBaseUrl(options)).hostname || domain;
  } catch {}
  const css = loadPortalCss();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JM WiFi</title>
  <style>${css}</style>
</head>
<body>
  <div class="atmosphere" aria-hidden="true"></div>
  <main class="shell">
    <header class="brand">
      <p class="brand-name" id="brand-name">JM WiFi</p>
      <p class="brand-domain">${domain}</p>
      <p class="tagline" id="site-name">Connect to the internet</p>
    </header>
    <section class="access" aria-label="WiFi access">
      <div class="tabs" role="tablist">
        <button type="button" class="tab active" data-tab="voucher" role="tab">Vouchers</button>
        <button type="button" class="tab" data-tab="coin" role="tab">Coins</button>
      </div>
      <div id="voucher-panel" class="panel active">
        <p class="info">Enter the code from the coin machine or calling. Time will pause when disconnected — no validity expiry. Random MAC OK.</p>
        <form id="voucher-form">
          <input type="text" id="voucher-code" placeholder="XXXXXXXX" maxlength="12" autocomplete="off" required aria-label="Voucher code">
          <button type="submit" class="btn-primary">Connect</button>
        </form>
      </div>
      <div id="coin-panel" class="panel">
        <h2>Insert coin</h2>
        <p class="info">Go to the coin machine, get your code, then enter it in the Vouchers tab.</p>
        <p class="rate" id="coin-rate">1 coin = 5 minutes</p>
        <ol class="steps">
          <li>Insert coin in the machine</li>
          <li>Read the voucher code</li>
          <li>Enter here and tap Connect</li>
        </ol>
        <div id="plans" class="plans"></div>
      </div>
      <div id="status" class="status hidden" role="status"></div>
    </section>
    <footer class="footer">
      <p>Powered by JM Tech Solution</p>
      <p class="mac-info" id="mac-display"></p>
    </footer>
  </main>
  <script>
  (function () {
    var SITE_ID = ${JSON.stringify(siteId)};
    var API_BASE = ${JSON.stringify(apiBase)};
    var MAC = '$(mac)';
    var IP = '$(ip)';
    var LINK_LOGIN = '$(link-login-only)';
    var ERROR = '$(error)';

    if (MAC.indexOf('$(') !== -1) MAC = '';
    if (IP.indexOf('$(') !== -1) IP = '';
    if (LINK_LOGIN.indexOf('$(') !== -1) LINK_LOGIN = '';
    if (ERROR.indexOf('$(') !== -1) ERROR = '';

    var statusEl = document.getElementById('status');
    var macDisplay = document.getElementById('mac-display');
    var form = document.getElementById('voucher-form');
    var codeInput = document.getElementById('voucher-code');

    if (MAC) macDisplay.textContent = 'MAC: ' + MAC;
    if (ERROR) showStatus('Login failed: ' + ERROR, 'error');

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-panel').classList.add('active');
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code) return;
      if (!MAC) {
        showStatus('Connect to JM WiFi first, then open http://10.0.0.1', 'error');
        return;
      }

      var btn = form.querySelector('button');
      btn.disabled = true;
      showStatus('Verifying voucher...', 'info');

      fetch(API_BASE + '/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, mac: MAC, site_id: SITE_ID, ip: IP })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) {
            showStatus(data.error, 'error');
            btn.disabled = false;
            return;
          }
          showStatus((data.resumed ? 'Resumed! ' : 'Connected! ') +
            (data.remaining_minutes || data.minutes) + ' min left.', 'success');
          if (LINK_LOGIN) {
            var loginUrl = LINK_LOGIN;
            if (loginUrl.indexOf('?') === -1) {
              loginUrl += '?username=' + encodeURIComponent(data.username) +
                '&password=' + encodeURIComponent(data.password);
            }
            setTimeout(function () { window.location.href = loginUrl; }, 1200);
          } else {
            btn.disabled = false;
          }
        })
        .catch(function () {
          showStatus('Cannot reach cloud API. Check walled garden / internet.', 'error');
          btn.disabled = false;
        });
    });

    function showStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.className = 'status ' + type;
      statusEl.classList.remove('hidden');
    }

    fetch(API_BASE + '/portal-config/' + encodeURIComponent(SITE_ID))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error || !data.site) return;
        document.getElementById('brand-name').textContent = data.site.portal_title || 'JM WiFi';
        document.getElementById('site-name').textContent = data.site.name || 'Connect to the internet';
        document.getElementById('coin-rate').textContent = '1 coin = ' + data.site.minutes_per_coin + ' minutes';
        document.title = (data.site.portal_title || 'JM WiFi') + ' Login';
        var plansEl = document.getElementById('plans');
        if (data.plans && data.plans.length) {
          plansEl.innerHTML = data.plans.map(function (p) {
            return '<div class="plan"><span>' + p.name + '</span><span>' +
              p.coins + ' coin → ' + p.minutes + ' min</span></div>';
          }).join('');
        }
      })
      .catch(function () { /* offline branding OK */ });
  })();
  </script>
</body>
</html>`;
}

module.exports = { buildMikrotikLoginHtml };
