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
    'hotspot-vendo': 'Operations · ALL VENDO · Cloud Hotspot',
    'vlan-detail': 'Operations · ALL VENDO · Cloud Hotspot · VLAN',
    'empty-bottle': 'Operations · ALL VENDO · Empty Bottle',
    gasoline: 'Operations · Gasoline Vendo',
    jmmarket: 'Operations · JM Market',
    settings: 'Operations · Settings',
    accounts: 'Operations · Accounts',
    vpnserver: 'Operations · VPN Server'
  };

  let vendoCache = null;
  let currentVlanId = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function peso(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0 });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function expandAllVendo() {
    $('children-allvendo')?.classList.add('open');
    $('nav-tree-allvendo')?.classList.add('expanded');
    const chevron = $('chevron-allvendo');
    if (chevron) chevron.textContent = '▾';
  }

  function collapseAllVendo() {
    $('children-allvendo')?.classList.remove('open');
    $('nav-tree-allvendo')?.classList.remove('expanded');
    const chevron = $('chevron-allvendo');
    if (chevron) chevron.textContent = '▸';
    collapseHotspot();
  }

  function expandHotspot() {
    expandAllVendo();
    $('children-vlans')?.classList.add('open');
    $('nav-tree-hotspot')?.classList.add('expanded');
    const chevron = $('chevron-hotspot');
    if (chevron) chevron.textContent = '▾';
  }

  function collapseHotspot() {
    $('children-vlans')?.classList.remove('open');
    $('nav-tree-hotspot')?.classList.remove('expanded');
    const chevron = $('chevron-hotspot');
    if (chevron) chevron.textContent = '▸';
  }

  function setNavActive(name) {
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
    document.querySelectorAll('.nav-btn.nav-vlan').forEach(function (b) {
      b.classList.toggle('active', name === 'vlan-detail' && b.dataset.siteId === currentVlanId);
    });

    const inAllVendo = ['allvendo', 'hotspot-vendo', 'vlan-detail', 'empty-bottle'].includes(name);
    $('btn-allvendo-toggle')?.classList.toggle('active', inAllVendo);
    $('btn-hotspot-toggle')?.classList.toggle('active', name === 'hotspot-vendo' || name === 'vlan-detail');

    if (inAllVendo) {
      expandAllVendo();
      if (name === 'hotspot-vendo' || name === 'vlan-detail') {
        expandHotspot();
      }
    }
  }

  function showView(name, params) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.remove('active');
    });

    if (params && params.siteId) currentVlanId = params.siteId;

    const view = $('view-' + name);
    if (view) view.classList.add('active');

    setNavActive(name);

    const bc = $('breadcrumb');
    if (bc) bc.textContent = views[name] || name;

    document.body.classList.remove('drawer-open');

    if (name === 'allvendo' || name === 'dashboard') loadVendoData();
    if (name === 'hotspot-vendo') loadHotspotData();
    if (name === 'vlan-detail' && currentVlanId) loadVlanDetail(currentVlanId);
    if (name === 'empty-bottle') loadBottleData();
  }

  window.showView = showView;

  // Toggle ALL VENDO — click to show/hide Empty Bottle & Cloud Hotspot
  $('btn-allvendo-toggle')?.addEventListener('click', function () {
    const children = $('children-allvendo');
    const isOpen = children?.classList.contains('open');

    if (isOpen) {
      collapseAllVendo();
    } else {
      expandAllVendo();
      showView('allvendo');
    }
  });

  // Toggle Cloud Hotspot — click to show/hide VLANs
  $('btn-hotspot-toggle')?.addEventListener('click', function (e) {
    e.stopPropagation();
    const children = $('children-vlans');
    const isOpen = children?.classList.contains('open');

    if (isOpen) {
      collapseHotspot();
      showView('hotspot-vendo');
    } else {
      expandHotspot();
      showView('hotspot-vendo');
    }
  });

  document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
    if (btn.id === 'btn-hotspot-toggle') return;
    btn.addEventListener('click', function () {
      if (btn.dataset.view === 'empty-bottle') expandAllVendo();
      showView(btn.dataset.view);
    });
  });

  document.querySelectorAll('[data-goto]').forEach(function (el) {
    el.addEventListener('click', function () {
      showView(el.dataset.goto);
    });
  });

  document.querySelectorAll('.vendo-type-card.clickable').forEach(function (el) {
    el.addEventListener('click', function () {
      showView(el.dataset.goto);
    });
  });

  $('menu-toggle')?.addEventListener('click', function () {
    document.body.classList.toggle('drawer-open');
  });

  $('btn-refresh-vendo')?.addEventListener('click', loadVendoData);
  $('btn-refresh-hotspot')?.addEventListener('click', loadHotspotData);
  $('btn-refresh-bottle')?.addEventListener('click', loadBottleData);

  function renderVlanNav(sites) {
    const container = $('children-vlans');
    if (!container) return;

    if (!sites || !sites.length) {
      container.innerHTML = '<div class="nav-vlan-empty">Walang VLAN pa</div>';
      return;
    }

    container.innerHTML = sites.map(function (s) {
      return '<button class="nav-btn nav-grandchild nav-vlan" data-view="vlan-detail" data-site-id="' +
        esc(s.id) + '" type="button">' +
        '<span class="ico vlan-dot ' + (s.online_devices > 0 ? 'online' : '') + '">●</span>' +
        '<span class="nav-label">VLAN ' + s.vlan_id + ' — ' + esc(s.name) + '</span>' +
        '</button>';
    }).join('');

    container.querySelectorAll('.nav-vlan').forEach(function (btn) {
      btn.addEventListener('click', function () {
        expandHotspot();
        showView('vlan-detail', { siteId: btn.dataset.siteId });
      });
    });
  }

  function renderVlanGrid(sites, containerId) {
    const grid = $(containerId);
    if (!grid) return;

    if (!sites || !sites.length) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">📶</span><p>Walang VLAN / hotspot site pa.</p><p class="empty-sub">Gumawa ng site via API: POST /api/admin/create-site</p></div>';
      return;
    }

    grid.innerHTML = sites.map(function (s) {
      return '<div class="vlan-card ' + (s.online_devices > 0 ? 'online' : 'offline') + '" data-site-id="' + esc(s.id) + '">' +
        '<div class="vlan-card-head">' +
          '<span class="vlan-badge">VLAN ' + s.vlan_id + '</span>' +
          '<span class="status-pill ' + (s.online_devices > 0 ? 'on' : 'off') + '">' +
            (s.online_devices > 0 ? 'Online' : 'Offline') + '</span>' +
        '</div>' +
        '<h3>' + esc(s.name) + '</h3>' +
        '<div class="vlan-card-stats">' +
          '<div><span>Devices</span><strong>' + s.devices + '</strong></div>' +
          '<div><span>Sessions</span><strong>' + s.active_sessions + '</strong></div>' +
          '<div><span>Coins</span><strong>' + s.coins_today + '</strong></div>' +
        '</div>' +
        '<div class="vlan-card-foot">₱' + s.rate_per_hour + '/hr · ' + s.minutes_per_coin + ' min/coin</div>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('.vlan-card').forEach(function (card) {
      card.addEventListener('click', function () {
        showView('vlan-detail', { siteId: card.dataset.siteId });
      });
    });
  }

  function renderCoinLogs(logs, tableId) {
    const logsBody = $(tableId || 'coin-logs-table');
    if (!logsBody) return;

    if (!logs || !logs.length) {
      logsBody.innerHTML = '<tr><td colspan="5" class="empty">Walang coin transaction pa.</td></tr>';
      return;
    }

    logsBody.innerHTML = logs.map(function (c) {
      const vlanLabel = c.vlan_id ? 'VLAN ' + c.vlan_id + ' — ' : '';
      return '<tr>' +
        '<td>' + formatTime(c.created_at) + '</td>' +
        '<td>' + esc(vlanLabel + (c.site_name || '—')) + '</td>' +
        '<td>' + c.coins + '</td>' +
        '<td>' + c.minutes_granted + ' min</td>' +
        '<td><code>' + esc(c.voucher_code) + '</code></td>' +
        '</tr>';
    }).join('');
  }

  async function fetchVendoData() {
    const res = await fetch('/api/vendo/overview');
    vendoCache = await res.json();
    return vendoCache;
  }

  async function loadVendoData() {
    try {
      const data = await fetchVendoData();

      if ($('kpi-wifi')) $('kpi-wifi').textContent = peso(data.wifi.revenue_today);
      if ($('kpi-wifi-sub')) $('kpi-wifi-sub').textContent = data.wifi.coins_today + ' coins · ' + data.wifi.sessions_today + ' sessions';

      if ($('vendo-total-sales')) $('vendo-total-sales').textContent = peso(data.total_revenue_today);
      if ($('vendo-active')) $('vendo-active').textContent = data.active_devices;
      if ($('vendo-tx')) $('vendo-tx').textContent = data.wifi.coins_today;

      if ($('wifi-vlans-count')) $('wifi-vlans-count').textContent = data.sites.length;
      if ($('wifi-coins')) $('wifi-coins').textContent = data.wifi.coins_today;
      if ($('wifi-revenue')) $('wifi-revenue').textContent = peso(data.wifi.revenue_today);
      if ($('wifi-status')) {
        $('wifi-status').textContent = data.active_devices > 0 ? 'Online' : 'No devices';
        $('wifi-status').className = 'badge ' + (data.active_devices > 0 ? 'online' : '');
      }

      renderVlanNav(data.sites);
    } catch (err) {
      console.error('Failed to load vendo data:', err);
    }
  }

  async function loadHotspotData() {
    try {
      const data = vendoCache || await fetchVendoData();

      const totalSessions = data.sites.reduce(function (a, s) { return a + s.active_sessions; }, 0);
      const totalCoins = data.sites.reduce(function (a, s) { return a + s.coins_today; }, 0);

      if ($('hotspot-vlan-count')) $('hotspot-vlan-count').textContent = data.sites.length;
      if ($('hotspot-sessions')) $('hotspot-sessions').textContent = totalSessions;
      if ($('hotspot-coins')) $('hotspot-coins').textContent = totalCoins;

      renderVlanGrid(data.sites, 'vlan-grid');
      renderVlanNav(data.sites);
      renderCoinLogs(data.recent_coins);
    } catch (err) {
      console.error('Failed to load hotspot data:', err);
    }
  }

  async function loadVlanDetail(siteId) {
    try {
      const res = await fetch('/api/vendo/vlan/' + siteId);
      const data = await res.json();
      if (data.error) return;

      const title = $('vlan-detail-title');
      if (title) title.textContent = 'VLAN ' + data.site.vlan_id + ' — ' + data.site.name;

      const stats = $('vlan-detail-stats');
      if (stats) {
        stats.innerHTML =
          '<div class="summary-card"><span class="summary-label">VLAN ID</span><span class="summary-value">' + data.site.vlan_id + '</span></div>' +
          '<div class="summary-card"><span class="summary-label">Active Sessions</span><span class="summary-value">' + data.active_sessions + '</span></div>' +
          '<div class="summary-card"><span class="summary-label">Coins Today</span><span class="summary-value">' + data.coins_today + '</span></div>';
      }

      const devBody = $('vlan-devices-table');
      if (devBody) {
        if (!data.devices.length) {
          devBody.innerHTML = '<tr><td colspan="5" class="empty">Walang device na naka-register.</td></tr>';
        } else {
          devBody.innerHTML = data.devices.map(function (d) {
            return '<tr>' +
              '<td><strong>' + esc(d.name) + '</strong></td>' +
              '<td>' + esc(d.device_type) + '</td>' +
              '<td><code>' + esc(d.mac_address) + '</code></td>' +
              '<td class="' + (d.status === 'online' ? 'status-online' : 'status-offline') + '">' + esc(d.status) + '</td>' +
              '<td>' + formatTime(d.last_seen) + '</td></tr>';
          }).join('');
        }
      }

      const sessBody = $('vlan-sessions-table');
      if (sessBody) {
        if (!data.sessions.length) {
          sessBody.innerHTML = '<tr><td colspan="5" class="empty">Walang active session.</td></tr>';
        } else {
          sessBody.innerHTML = data.sessions.map(function (s) {
            return '<tr>' +
              '<td><code>' + esc(s.mac_address) + '</code></td>' +
              '<td>' + esc(s.username) + '</td>' +
              '<td>' + s.minutes_granted + ' min</td>' +
              '<td>' + formatTime(s.expires_at) + '</td>' +
              '<td class="status-online">' + esc(s.status) + '</td></tr>';
          }).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load VLAN detail:', err);
    }
  }

  function loadBottleData() {
    // Placeholder — ready for bottle vendo API integration
    if ($('bottle-today')) $('bottle-today').textContent = '0';
    if ($('bottle-revenue')) $('bottle-revenue').textContent = peso(0);
    if ($('bottle-machines')) $('bottle-machines').textContent = '0';
    if ($('bottle-count')) $('bottle-count').textContent = '0';
    if ($('bottle-sales')) $('bottle-sales').textContent = peso(0);
  }

  // URL hash routing e.g. #allvendo, #hotspot-vendo, #vlan/SITE_ID
  const hash = location.hash.replace('#', '');
  if (hash.startsWith('vlan/')) {
    showView('vlan-detail', { siteId: hash.split('/')[1] });
  } else if (hash && views[hash]) {
    showView(hash);
  } else {
    loadVendoData();
  }
})();
