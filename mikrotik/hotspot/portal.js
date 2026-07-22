/* JM WiFi MikroTik captive portal — built per site on push */
(function () {
  'use strict';

  var CFG = {
    siteId: '{{SITE_ID}}',
    apiBase: '{{API_BASE}}'
  };

  var MAC = '$(mac)';
  var IP = '$(ip)';
  var LINK_LOGIN = '$(link-login-only)';
  var ERROR = '$(error)';

  if (MAC.indexOf('$(') !== -1) MAC = '';
  if (IP.indexOf('$(') !== -1) IP = '';
  if (LINK_LOGIN.indexOf('$(') !== -1) LINK_LOGIN = '';
  if (ERROR.indexOf('$(') !== -1) ERROR = '';

  function $(id) { return document.getElementById(id); }

  function showStatus(msg, type) {
    var el = $('status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status ' + type;
    el.classList.remove('hidden');
  }

  function initTabs() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var panel = $(tab.getAttribute('data-tab') + '-panel');
        if (panel) panel.classList.add('active');
      });
    });
  }

  function initVoucherForm() {
    var form = $('voucher-form');
    if (!form) return;
    var codeInput = $('voucher-code');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code) return;
      if (!MAC) {
        showStatus('Connect to JM WiFi, then open http://10.0.0.1', 'error');
        return;
      }
      var btn = form.querySelector('button');
      btn.disabled = true;
      showStatus('Verifying voucher...', 'info');
      fetch(CFG.apiBase + '/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, mac: MAC, site_id: CFG.siteId, ip: IP })
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
          showStatus('Cannot reach cloud API. Check walled garden.', 'error');
          btn.disabled = false;
        });
    });
  }

  function loadBranding() {
    if (!CFG.siteId) return;
    fetch(CFG.apiBase + '/portal-config/' + encodeURIComponent(CFG.siteId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error || !data.site) return;
        if ($('brand-name')) $('brand-name').textContent = data.site.portal_title || 'JM WiFi';
        if ($('site-name')) $('site-name').textContent = data.site.name || 'Connect to the internet';
        if ($('coin-rate')) $('coin-rate').textContent = '1 coin = ' + data.site.minutes_per_coin + ' minutes';
        document.title = (data.site.portal_title || 'JM WiFi') + ' Login';
        var plansEl = $('plans');
        if (plansEl && data.plans && data.plans.length) {
          plansEl.innerHTML = data.plans.map(function (p) {
            return '<div class="plan"><span>' + p.name + '</span><span>' +
              p.coins + ' coin → ' + p.minutes + ' min</span></div>';
          }).join('');
        }
      })
      .catch(function () {});
  }

  function initLoginPage() {
    if ($('mac-display') && MAC) $('mac-display').textContent = 'MAC: ' + MAC;
    if (ERROR) showStatus('Login failed: ' + ERROR, 'error');
    initTabs();
    initVoucherForm();
    loadBranding();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginPage);
  } else {
    initLoginPage();
  }
})();
