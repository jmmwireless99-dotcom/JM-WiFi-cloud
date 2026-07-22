(function () {
  'use strict';

  const views = {
    dashboard: 'Home · Dashboard',
    locations: 'Home · Locations',
    livewall: 'Home · Live Wall',
    fleetmap: 'Home · Fleet Map',
    cctv: 'Operations · CCTV',
    vpn: 'Operations · VPN Clients',
    zerotier: 'Operations · ZeroTier',
    allvendo: 'Operations · ALL VENDO',
    gasoline: 'Operations · Gasoline Vendo',
    jmmarket: 'Operations · JM Market',
    settings: 'Operations · Settings',
    accounts: 'Operations · Accounts',
    vpnserver: 'Operations · VPN Server',
    'wifi-detail': 'Operations · ALL VENDO · WiFi Sites'
  };

  function $(id) { return document.getElementById(id); }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.remove('active');
    });
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });

    const view = $('view-' + name);
    if (view) view.classList.add('active');

    const bc = $('breadcrumb');
    if (bc) bc.textContent = views[name] || name;

    document.body.classList.remove('drawer-open');

    if (name === 'allvendo' || name === 'dashboard') loadVendoData();
    if (name === 'wifi-detail') loadSitesList();
  }

  window.showView = showView;

  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showView(btn.dataset.view);
    });
  });

  document.querySelectorAll('[data-goto]').forEach(function (el) {
    el.addEventListener('click', function () {
      showView(el.dataset.goto);
    });
  });

  $('menu-toggle')?.addEventListener('click', function () {
    document.body.classList.toggle('drawer-open');
  });

  $('btn-refresh-vendo')?.addEventListener('click', loadVendoData);

  function peso(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0 });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function loadVendoData() {
    try {
      const res = await fetch('/api/vendo/overview');
      const data = await res.json();

      // Dashboard KPIs
      if ($('kpi-wifi')) $('kpi-wifi').textContent = peso(data.wifi.revenue_today);
      if ($('kpi-wifi-sub')) $('kpi-wifi-sub').textContent = data.wifi.coins_today + ' coins · ' + data.wifi.sessions_today + ' sessions';

      // ALL VENDO summary
      if ($('vendo-total-sales')) $('vendo-total-sales').textContent = peso(data.total_revenue_today);
      if ($('vendo-active')) $('vendo-active').textContent = data.active_devices;
      if ($('vendo-tx')) $('vendo-tx').textContent = data.wifi.coins_today;

      // WiFi card
      if ($('wifi-coins')) $('wifi-coins').textContent = data.wifi.coins_today;
      if ($('wifi-sessions')) $('wifi-sessions').textContent = data.wifi.sessions_today;
      if ($('wifi-revenue')) $('wifi-revenue').textContent = peso(data.wifi.revenue_today);
      if ($('wifi-status')) {
        $('wifi-status').textContent = data.active_devices > 0 ? 'Online' : 'No devices';
        $('wifi-status').className = 'badge ' + (data.active_devices > 0 ? 'online' : '');
      }

      // Sites table
      const sitesBody = $('wifi-sites-table');
      if (sitesBody && data.sites) {
        if (!data.sites.length) {
          sitesBody.innerHTML = '<tr><td colspan="5" class="empty">Walang site pa. Gumawa via API.</td></tr>';
        } else {
          sitesBody.innerHTML = data.sites.map(function (s) {
            return '<tr>' +
              '<td><strong>' + esc(s.name) + '</strong></td>' +
              '<td>' + s.devices + ' (' + s.online_devices + ' online)</td>' +
              '<td>' + s.active_sessions + '</td>' +
              '<td>' + s.coins_today + '</td>' +
              '<td class="' + (s.online_devices > 0 ? 'status-online' : 'status-offline') + '">' +
                (s.online_devices > 0 ? '● Online' : '○ Offline') + '</td>' +
              '</tr>';
          }).join('');
        }
      }

      // Coin logs table
      const logsBody = $('coin-logs-table');
      if (logsBody && data.recent_coins) {
        if (!data.recent_coins.length) {
          logsBody.innerHTML = '<tr><td colspan="5" class="empty">Walang coin transaction pa.</td></tr>';
        } else {
          logsBody.innerHTML = data.recent_coins.map(function (c) {
            return '<tr>' +
              '<td>' + formatTime(c.created_at) + '</td>' +
              '<td>' + esc(c.site_name || '—') + '</td>' +
              '<td>' + c.coins + '</td>' +
              '<td>' + c.minutes_granted + ' min</td>' +
              '<td><code>' + esc(c.voucher_code) + '</code></td>' +
              '</tr>';
          }).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load vendo data:', err);
    }
  }

  async function loadSitesList() {
    const el = $('sites-list');
    if (!el) return;

    try {
      const res = await fetch('/api/vendo/overview');
      const data = await res.json();

      if (!data.sites || !data.sites.length) {
        el.innerHTML = '<p class="empty" style="padding:24px;text-align:center;color:var(--muted)">Walang WiFi site. Gumawa gamit ang /api/admin/create-site</p>';
        return;
      }

      el.innerHTML = data.sites.map(function (s) {
        return '<div class="site-card">' +
          '<div><h4>' + esc(s.name) + '</h4>' +
          '<p>' + s.devices + ' devices · ' + s.coins_today + ' coins today · Rate: ₱' + s.rate_per_hour + '/hr</p></div>' +
          '<span class="badge ' + (s.online_devices > 0 ? 'online' : '') + '">' +
            (s.online_devices > 0 ? 'Online' : 'Offline') + '</span></div>';
      }).join('');
    } catch (err) {
      el.innerHTML = '<p class="empty">Error loading sites.</p>';
    }
  }

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Check URL hash for direct link e.g. #allvendo
  const hash = location.hash.replace('#', '');
  if (hash && views[hash]) {
    showView(hash);
  } else {
    loadVendoData();
  }
})();
