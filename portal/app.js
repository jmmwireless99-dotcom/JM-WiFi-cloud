(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const basePath = (window.JM_BASE_PATH || '').replace(/\/$/, '');
  const config = {
    apiBase: params.get('api') || (window.JM_API_BASE || (basePath + '/api') || '/api'),
    siteId: params.get('site_id') || '',
    mac: params.get('mac') || params.get('mac-esc') || '',
    ip: params.get('ip') || '',
    linkLogin: params.get('link-login') || params.get('link-login-only') || '',
    linkOrig: params.get('link-orig') || params.get('dst') || 'http://www.google.com',
    error: params.get('error') || ''
  };

  const statusEl = document.getElementById('status');
  const macDisplay = document.getElementById('mac-display');
  const form = document.getElementById('voucher-form');
  const codeInput = document.getElementById('voucher-code');

  if (config.mac) macDisplay.textContent = 'MAC: ' + config.mac;
  if (config.error) showStatus('Login failed: ' + config.error, 'error');

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

    var btn = form.querySelector('button');
    btn.disabled = true;
    showStatus('Verifying voucher...', 'info');

    fetch(config.apiBase + '/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        mac: config.mac,
        site_id: config.siteId,
        ip: config.ip
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          showStatus(data.error, 'error');
          btn.disabled = false;
          return;
        }

        showStatus((data.resumed ? 'Resumed! ' : 'Connected! ') +
          (data.remaining_minutes || data.minutes) + ' min left (pause on disconnect).', 'success');

        if (config.linkLogin) {
          var loginUrl = config.linkLogin;
          if (loginUrl.indexOf('?') === -1) {
            loginUrl += '?username=' + encodeURIComponent(data.username) +
              '&password=' + encodeURIComponent(data.password);
          }
          setTimeout(function () { window.location.href = loginUrl; }, 1200);
        } else {
          showStatus('Access granted for ' + data.minutes + ' min. Username: ' + data.username, 'success');
          btn.disabled = false;
        }
      })
      .catch(function () {
        showStatus('Connection error. Please try again.', 'error');
        btn.disabled = false;
      });
  });

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    statusEl.classList.remove('hidden');
  }

  if (config.siteId) {
    fetch(config.apiBase + '/portal-config/' + encodeURIComponent(config.siteId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error || !data.site) return;
        document.getElementById('brand-name').textContent = data.site.portal_title || 'JM WiFi';
        document.getElementById('site-name').textContent = data.site.name;
        document.getElementById('coin-rate').textContent =
          '1 coin = ' + data.site.minutes_per_coin + ' minutes';
        document.title = (data.site.portal_title || 'JM WiFi') + ' Login';

        var plansEl = document.getElementById('plans');
        if (data.plans && data.plans.length) {
          plansEl.innerHTML = data.plans.map(function (p) {
            return '<div class="plan"><span>' + p.name + '</span><span>' +
              p.coins + ' coin → ' + p.minutes + ' min</span></div>';
          }).join('');
        }
      })
      .catch(function () { /* ignore */ });
  }
})();
