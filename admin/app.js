(function () {
  'use strict';

  const BASE = (window.JM_BASE_PATH || '').replace(/\/$/, '');
  const API = (window.JM_API_BASE || (BASE + '/api')) + '/admin';
  const state = {
    token: localStorage.getItem('jm_token') || '',
    operator: null,
    vendos: [],
    page: 'dashboard'
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(API + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout(false);
      throw new Error(data.error || 'Unauthorized');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function money(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#op-name').textContent = state.operator.name + ' · ' + state.operator.role;
  }

  function showLogin() {
    $('#app-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
  }

  function logout(clear = true) {
    if (clear) localStorage.removeItem('jm_token');
    state.token = '';
    state.operator = null;
    showLogin();
  }

  async function boot() {
    if (!state.token) {
      showLogin();
      return;
    }
    try {
      const data = await api('/me');
      state.operator = data.operator;
      showApp();
      navigate(initialPage());
    } catch {
      showLogin();
    }
  }

  // ── Auth ──
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          email: $('#login-email').value,
          password: $('#login-password').value
        })
      });
      state.token = data.token;
      state.operator = data.operator;
      localStorage.setItem('jm_token', data.token);
      showApp();
      navigate(initialPage());
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#logout-btn').addEventListener('click', () => logout());

  // ── Navigation ──
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });

  $$('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.goto));
  });

  const titles = {
    hub: 'All Vendo',
    'empty-bottle': 'Empty Bottle',
    hotspot: 'Cloud Hotspot',
    'hs-server': 'Hotspot Server',
    dashboard: 'Hotspot Overview',
    vendos: 'Mga Vendo',
    devices: 'Devices',
    sessions: 'Sessions',
    vouchers: 'Vouchers',
    sales: 'Sales',
    reports: 'Reports'
  };

  async function navigate(page) {
    state.page = page;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    $('#page-title').textContent = titles[page] || page;

    const url = new URL(location.href);
    if (page === 'empty-bottle' || page === 'hotspot' || page === 'hub' || page === 'hs-server') {
      url.searchParams.set('module', page === 'hub' ? 'hub' : page);
    }
    history.replaceState(null, '', url);

    const loaders = {
      dashboard: loadDashboard,
      'hs-server': loadHotspotServer,
      vendos: loadVendos,
      devices: loadDevices,
      sessions: loadSessions,
      vouchers: loadVouchers,
      sales: loadSales,
      reports: loadReports
    };
    if (loaders[page]) await loaders[page]();
  }

  function initialPage() {
    const mod = new URLSearchParams(location.search).get('module');
    if (mod === 'empty-bottle') return 'empty-bottle';
    if (mod === 'hotspot') return 'hotspot';
    if (mod === 'hs-server') return 'hs-server';
    if (mod === 'hub') return 'hub';
    return 'hub';
  }

  // ── Dashboard ──
  async function loadDashboard() {
    const stats = await api('/dashboard');
    $('#stat-grid').innerHTML = [
      ['Vendos', stats.vendos],
      ['Devices online', stats.devices_online + ' / ' + stats.devices_total],
      ['Active sessions', stats.active_sessions],
      ['Unused vouchers', stats.unused_vouchers]
    ].map(([label, value]) => `
      <div class="stat">
        <div class="label">${esc(label)}</div>
        <div class="value">${esc(value)}</div>
      </div>
    `).join('');

    $('#today-sales-detail').innerHTML = `
      <div><strong>${money(stats.sales.today.amount)}</strong></div>
      <div>${stats.sales.today.coins} coins · ${stats.sales.today.txns} transactions</div>
      <div style="margin-top:10px">Week: <strong>${money(stats.sales.week.amount)}</strong></div>
      <div>Month: <strong>${money(stats.sales.month.amount)}</strong></div>
    `;
  }

  // ── Vendos ──
  async function loadVendos() {
    const data = await api('/vendos');
    state.vendos = data.vendos;
    if (!data.vendos.length) {
      $('#vendo-list').innerHTML = '<p class="empty">Walang vendo pa. Magdagdag ng una.</p>';
      return;
    }
    $('#vendo-list').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Status</th><th>Devices</th><th>Sessions</th>
            <th>Sales today</th><th>Rate</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${data.vendos.map((v) => `
            <tr>
              <td>
                <strong>${esc(v.name)}</strong><br>
                <span class="mono" style="color:var(--muted)">${esc(v.address || '—')}</span>
              </td>
              <td><span class="badge ${v.status === 'active' ? 'active' : 'offline'}">${esc(v.status)}</span></td>
              <td>${v.online_count}/${v.device_count}</td>
              <td>${v.active_sessions}</td>
              <td>${money(v.sales_today)}</td>
              <td>${v.minutes_per_coin} min/coin</td>
              <td>
                <button class="btn-secondary" data-vendo-view="${v.id}">Open</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    $$('[data-vendo-view]').forEach((btn) => {
      btn.addEventListener('click', () => openVendoDetail(btn.dataset.vendoView));
    });
  }

  async function openVendoDetail(id) {
    const data = await api('/vendos/' + id);
    const v = data.vendo;
    const dlg = $('#vendo-detail-dialog');
    $('#detail-title').textContent = v.name;
    $('#vendo-detail-body').innerHTML = `
      <dl class="detail-grid">
        <dt>Site ID</dt><dd class="mono">${esc(v.id)}</dd>
        <dt>API Key</dt><dd class="mono">${esc(v.api_key)}</dd>
        <dt>Portal</dt><dd class="mono">/portal/?site_id=${esc(v.id)}</dd>
        <dt>MikroTik</dt><dd>${esc(v.mikrotik_host || '—')} (${esc(v.mikrotik_user || 'admin')})</dd>
        <dt>Bandwidth</dt><dd>${esc(v.bandwidth_down)} down / ${esc(v.bandwidth_up)} up</dd>
        <dt>Plans</dt>
        <dd>${data.plans.map((p) => `${esc(p.name)}: ${p.coins} coin → ${p.minutes} min (₱${p.price})`).join('<br>') || '—'}</dd>
        <dt>Devices</dt>
        <dd>${data.devices.map((d) => `${esc(d.name)} · ${esc(d.device_type)} · <span class="badge ${d.status}">${esc(d.status)}</span>`).join('<br>') || 'None yet'}</dd>
      </dl>
      <div class="action-row" style="margin-top:16px">
        <button class="btn-secondary" id="btn-regen-key" data-id="${v.id}">Regenerate API key</button>
        <button class="btn-danger" id="btn-delete-vendo" data-id="${v.id}">Delete vendo</button>
      </div>
    `;
    dlg.showModal();
    $('#btn-regen-key')?.addEventListener('click', async () => {
      if (!confirm('Mag-regenerate ng API key? Kailangan i-update ang ESP8266/MikroTik.')) return;
      const r = await api('/vendos/' + id + '/regenerate-key', { method: 'POST' });
      alert('New API key: ' + r.api_key);
      openVendoDetail(id);
    });
    $('#btn-delete-vendo')?.addEventListener('click', async () => {
      if (!confirm('Delete this vendo and all related data?')) return;
      await api('/vendos/' + id, { method: 'DELETE' });
      dlg.close();
      loadVendos();
    });
  }

  $('#detail-close').addEventListener('click', () => $('#vendo-detail-dialog').close());

  $('#btn-new-vendo').addEventListener('click', () => {
    $('#vendo-form').reset();
    $('#vendo-dialog').showModal();
  });
  $('#vendo-cancel').addEventListener('click', () => $('#vendo-dialog').close());

  $('#vendo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.minutes_per_coin = Number(body.minutes_per_coin);
    body.coin_value = Number(body.coin_value);
    const data = await api('/vendos', { method: 'POST', body: JSON.stringify(body) });
    $('#vendo-dialog').close();
    alert('Vendo created!\n\nAPI Key: ' + data.api_key + '\n\nI-save ito para sa ESP8266 at MikroTik.');
    loadVendos();
  });

  // ── Devices ──
  async function loadDevices() {
    await api('/devices/refresh').catch(() => {});
    const data = await api('/devices');
    if (!data.devices.length) {
      $('#device-list').innerHTML = '<p class="empty">Walang registered devices.</p>';
      return;
    }
    $('#device-list').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Vendo</th><th>MAC</th><th>Status</th><th>Last seen</th></tr></thead>
        <tbody>
          ${data.devices.map((d) => `
            <tr>
              <td>${esc(d.name)}</td>
              <td>${esc(d.device_type)}</td>
              <td>${esc(d.site_name)}</td>
              <td class="mono">${esc(d.mac_address || '—')}</td>
              <td><span class="badge ${d.status}">${esc(d.status)}</span></td>
              <td>${esc(d.last_seen || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  $('#btn-refresh-devices').addEventListener('click', () => loadDevices());

  // ── Sessions ──
  async function loadSessions() {
    const data = await api('/sessions');
    if (!data.sessions.length) {
      $('#session-list').innerHTML = '<p class="empty">Walang active/paused sessions.</p>';
      return;
    }
    $('#session-list').innerHTML = `
      <table>
        <thead><tr><th>Vendo</th><th>MAC</th><th>User</th><th>Remaining</th><th>Status</th><th>Random MAC</th><th></th></tr></thead>
        <tbody>
          ${data.sessions.map((s) => `
            <tr>
              <td>${esc(s.site_name)}</td>
              <td class="mono">${esc(s.mac_address)}</td>
              <td class="mono">${esc(s.username)}</td>
              <td>${Math.ceil(Number(s.remaining_seconds || s.minutes_granted * 60 || 0) / 60)} min</td>
              <td><span class="badge ${s.status}">${esc(s.status)}</span></td>
              <td>${s.allow_random_mac ? 'yes' : 'no'}</td>
              <td><button class="btn-danger" data-disconnect="${s.id}">Pause</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    $$('[data-disconnect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api('/sessions/' + btn.dataset.disconnect + '/disconnect', { method: 'POST' });
        loadSessions();
      });
    });
  }

  // ── Hotspot Server / Profile (Kitifi-style) ──
  function setHsTab(tab) {
    $$('.hs-tab').forEach((t) => t.classList.toggle('active', t.dataset.hsTab === tab));
    $('#hs-server-panel').classList.toggle('hidden', tab !== 'server');
    $('#hs-profile-panel').classList.toggle('hidden', tab !== 'profile');
    $('#hs-toolbar-text').textContent = tab === 'server'
      ? 'VLAN hotspot servers — mixed MikroTik + cloud captive portal.'
      : 'User profiles — pause on disconnect, no validity, random MAC.';
    $('#btn-add-server').style.display = tab === 'server' ? '' : 'none';
    $('#btn-add-profile').style.display = tab === 'profile' ? '' : 'none';
  }

  async function loadHotspotServer() {
    setHsTab(document.querySelector('.hs-tab.active')?.dataset.hsTab || 'server');
    const [servers, profiles] = await Promise.all([
      api('/hotspot/servers'),
      api('/hotspot/profiles')
    ]);

    $('#hs-server-list').innerHTML = servers.servers.length ? `
      <table>
        <thead><tr><th>Name</th><th>HS Address</th><th>HTML Directory</th><th>Login By</th><th>VLAN</th><th>Action</th></tr></thead>
        <tbody>
          ${servers.servers.map((s) => `
            <tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td class="mono">${esc(s.hs_address)}</td>
              <td>${esc(s.html_directory)}</td>
              <td>${esc(s.login_by)}</td>
              <td>${s.vlan_id}</td>
              <td>
                <button class="btn-secondary" data-hs-script="${s.id}">Script</button>
                <button class="btn-danger" data-hs-del="${s.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">Walang server pa. Mag-click + Server.</p>';

    $('#hs-profile-list').innerHTML = profiles.profiles.length ? `
      <table>
        <thead><tr><th>Name</th><th>Rate</th><th>Pause</th><th>No validity</th><th>Random MAC</th><th>Keepalive</th><th>Action</th></tr></thead>
        <tbody>
          ${profiles.profiles.map((p) => `
            <tr>
              <td><strong>${esc(p.name)}</strong></td>
              <td class="mono">${esc(p.rate_limit)}</td>
              <td>${p.pause_on_disconnect ? 'yes' : 'no'}</td>
              <td>${p.no_validity ? 'yes' : 'no'}</td>
              <td>${p.allow_random_mac ? 'yes' : 'no'}</td>
              <td>${esc(p.keepalive_timeout)}</td>
              <td>
                <button class="btn-secondary" data-profile-script="${p.id}">Script</button>
                <button class="btn-danger" data-profile-del="${p.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">Walang profile pa. Mag-click + Profile.</p>';

    $$('[data-hs-script]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await api('/hotspot/servers/' + btn.dataset.hsScript + '/script');
        alert(r.script);
      });
    });
    $$('[data-hs-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this hotspot server?')) return;
        await api('/hotspot/servers/' + btn.dataset.hsDel, { method: 'DELETE' });
        loadHotspotServer();
      });
    });
    $$('[data-profile-script]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await api('/hotspot/profiles/' + btn.dataset.profileScript + '/script');
        alert(r.script);
      });
    });
    $$('[data-profile-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this profile?')) return;
        await api('/hotspot/profiles/' + btn.dataset.profileDel, { method: 'DELETE' });
        loadHotspotServer();
      });
    });
  }

  $$('.hs-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      setHsTab(tab.dataset.hsTab);
    });
  });

  $('#btn-refresh-hs')?.addEventListener('click', () => loadHotspotServer());
  $('#btn-add-server')?.addEventListener('click', () => {
    setHsTab('server');
    $('#hs-server-form').reset();
    $('#hs-server-dialog').showModal();
  });
  $('#btn-add-profile')?.addEventListener('click', () => {
    setHsTab('profile');
    $('#hs-profile-form').reset();
    $('#hs-profile-dialog').showModal();
  });
  $('#hs-server-cancel')?.addEventListener('click', () => $('#hs-server-dialog').close());
  $('#hs-profile-cancel')?.addEventListener('click', () => $('#hs-profile-dialog').close());

  $('#hs-server-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.vlan_id = Number(body.vlan_id);
    await api('/hotspot/servers', { method: 'POST', body: JSON.stringify(body) });
    $('#hs-server-dialog').close();
    loadHotspotServer();
  });

  $('#hs-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.shared_users = Number(body.shared_users || 1);
    body.pause_on_disconnect = fd.get('pause_on_disconnect') ? 1 : 0;
    body.no_validity = fd.get('no_validity') ? 1 : 0;
    body.allow_random_mac = fd.get('allow_random_mac') ? 1 : 0;
    const data = await api('/hotspot/profiles', { method: 'POST', body: JSON.stringify(body) });
    $('#hs-profile-dialog').close();
    if (data.script) alert('Profile created.\\n\\nMikroTik script:\\n' + data.script);
    loadHotspotServer();
  });

  // ── Vouchers ──
  async function loadVouchers() {
    const data = await api('/vouchers');
    if (!data.vouchers.length) {
      $('#voucher-list').innerHTML = '<p class="empty">Walang vouchers. Mag-generate.</p>';
      return;
    }
    $('#voucher-list').innerHTML = `
      <table>
        <thead><tr><th>Code</th><th>Vendo</th><th>Minutes</th><th>Price</th><th>Source</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          ${data.vouchers.map((v) => `
            <tr>
              <td class="mono"><strong>${esc(v.code)}</strong></td>
              <td>${esc(v.site_name)}</td>
              <td>${v.minutes}</td>
              <td>${money(v.price)}</td>
              <td>${esc(v.source)}</td>
              <td><span class="badge ${v.used ? 'used' : 'unused'}">${v.used ? 'used' : 'unused'}</span></td>
              <td>${esc(v.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  $('#btn-gen-voucher').addEventListener('click', async () => {
    if (!state.vendos.length) {
      const data = await api('/vendos');
      state.vendos = data.vendos;
    }
    const sel = $('#voucher-site');
    sel.innerHTML = state.vendos.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
    $('#voucher-dialog').showModal();
  });
  $('#voucher-cancel').addEventListener('click', () => $('#voucher-dialog').close());

  $('#voucher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.minutes = Number(body.minutes);
    body.count = Number(body.count);
    body.price = Number(body.price);
    const data = await api('/vouchers/generate', { method: 'POST', body: JSON.stringify(body) });
    $('#voucher-dialog').close();
    alert('Generated ' + data.count + ' vouchers.\n\n' + data.vouchers.map((v) => v.code).join('\n'));
    loadVouchers();
  });

  // ── Sales ──
  async function loadSales() {
    const data = await api('/sales');
    if (!data.sales.length) {
      $('#sales-list').innerHTML = '<p class="empty">Walang sales pa.</p>';
      return;
    }
    $('#sales-list').innerHTML = `
      <table>
        <thead><tr><th>Time</th><th>Vendo</th><th>Device</th><th>Coins</th><th>Amount</th><th>Minutes</th><th>Voucher</th></tr></thead>
        <tbody>
          ${data.sales.map((s) => `
            <tr>
              <td>${esc(s.created_at)}</td>
              <td>${esc(s.site_name)}</td>
              <td>${esc(s.device_name || '—')}</td>
              <td>${s.coins}</td>
              <td>${money(s.amount)}</td>
              <td>${s.minutes_granted}</td>
              <td class="mono">${esc(s.voucher_code || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ── Reports ──
  async function loadReports() {
    const period = $('#report-period').value;
    const data = await api('/reports/sales?period=' + period + '&days=60');

    $('#report-series').innerHTML = data.series.length ? `
      <table>
        <thead><tr><th>Period</th><th>Amount</th><th>Coins</th><th>Minutes</th><th>Txns</th></tr></thead>
        <tbody>
          ${data.series.map((r) => `
            <tr>
              <td>${esc(r.period)}</td>
              <td>${money(r.amount)}</td>
              <td>${r.coins}</td>
              <td>${r.minutes}</td>
              <td>${r.transactions}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">Walang data sa period na ito.</p>';

    $('#report-by-vendo').innerHTML = `
      <table>
        <thead><tr><th>Vendo</th><th>Amount</th><th>Coins</th><th>Txns</th></tr></thead>
        <tbody>
          ${data.by_vendo.map((r) => `
            <tr>
              <td>${esc(r.site_name)}</td>
              <td>${money(r.amount)}</td>
              <td>${r.coins}</td>
              <td>${r.transactions}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  $('#btn-load-report').addEventListener('click', () => loadReports());

  boot();
})();
