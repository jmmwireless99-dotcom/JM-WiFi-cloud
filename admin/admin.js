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
    vpnserver: 'Operations · VPN Server'
  };

  function $(id) { return document.getElementById(id); }

  function peso(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0 });
  }

  function setNavActive(name) {
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.remove('active');
    });

    const view = $('view-' + name);
    if (view) view.classList.add('active');

    setNavActive(name);

    const bc = $('breadcrumb');
    if (bc) bc.textContent = views[name] || name;

    document.body.classList.remove('drawer-open');

    if (name === 'allvendo' || name === 'dashboard') loadVendoData();
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

  async function loadVendoData() {
    try {
      const res = await fetch('/api/vendo/overview');
      const data = await res.json();

      if ($('kpi-wifi')) $('kpi-wifi').textContent = peso(data.wifi.revenue_today);
      if ($('kpi-wifi-sub')) $('kpi-wifi-sub').textContent = data.wifi.coins_today + ' coins · ' + data.wifi.sessions_today + ' sessions';

      if ($('vendo-total-sales')) $('vendo-total-sales').textContent = peso(data.total_revenue_today);
      if ($('vendo-active')) $('vendo-active').textContent = data.active_devices;
      if ($('vendo-tx')) $('vendo-tx').textContent = data.wifi.coins_today;
    } catch (err) {
      console.error('Failed to load vendo data:', err);
    }
  }

  const hash = location.hash.replace('#', '');
  if (hash && views[hash]) {
    showView(hash);
  } else {
    loadVendoData();
  }
})();
