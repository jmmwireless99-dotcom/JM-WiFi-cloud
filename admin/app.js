(function () {
  'use strict';

  const BASE = (window.JM_BASE_PATH || '').replace(/\/$/, '');
  const API = (window.JM_API_BASE || (BASE + '/api')) + '/admin';
  const state = {
    token: localStorage.getItem('jm_token') || '',
    operator: null,
    vendos: [],
    page: 'dashboard',
    systemTimer: null
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
    return '₱ ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtBytes(n) {
    const v = Number(n || 0);
    if (v >= 1024 ** 3) return (v / 1024 ** 3).toFixed(2) + ' GiB';
    if (v >= 1024 ** 2) return (v / 1024 ** 2).toFixed(2) + ' MiB';
    if (v >= 1024) return (v / 1024).toFixed(1) + ' KiB';
    return v + ' B';
  }

  function fmtUptime(sec) {
    sec = Math.floor(Number(sec) || 0);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${d}d. ${h}hr. ${m}min. ${s}sec.`;
  }

  function tickClock() {
    const el = $('#header-clock');
    if (!el) return;
    el.textContent = new Date().toLocaleString('en-PH', {
      month: '2-digit', day: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  }

  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#op-name').textContent = state.operator.name + ' · ' + state.operator.role;
    $('#op-name-short').textContent = state.operator.name || 'Admin';
    tickClock();
    setInterval(tickClock, 1000);
  }

  function showLogin() {
    $('#app-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    if (state.systemTimer) clearInterval(state.systemTimer);
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
  $('#btn-sidebar-toggle')?.addEventListener('click', () => {
    $('#app-view').classList.toggle('sidebar-collapsed');
  });
  $('#btn-refresh-page')?.addEventListener('click', () => navigate(state.page));

  $$('[data-toggle-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = btn.closest('.nav-group');
      g?.classList.toggle('open');
    });
  });

  // ── Navigation ──
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.nav-item');
    if (nav?.dataset.page) navigate(nav.dataset.page);
    const goto = e.target.closest('[data-goto]');
    if (goto?.dataset.goto) navigate(goto.dataset.goto);
  });

  const titles = {
    hotspot: 'Cloud Hotspot',
    'hs-server': 'Hotspot Server',
    dashboard: 'Dashboard',
    vendos: 'Vendo List',
    devices: 'Devices',
    sessions: 'Users',
    vouchers: 'Voucher Generator',
    sales: 'Sales Inventory',
    reports: 'Daily Sales Report'
  };

  const crumbs = {
    hotspot: 'Hotspot / Overview',
    'hs-server': 'Hotspot / Server',
    dashboard: 'Home / Dashboard',
    vendos: 'Home / Vendo List',
    devices: 'Hotspot / Devices',
    sessions: 'Hotspot / Users',
    vouchers: 'Home / Voucher Generator',
    sales: 'Home / Sales Inventory',
    reports: 'Home / Daily Sales Report'
  };

  async function navigate(page) {
    state.page = page;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    $('#page-title').textContent = titles[page] || page;
    $('#page-breadcrumb').textContent = crumbs[page] || ('Home / ' + page);

    // auto-open parent group
    const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
    activeNav?.closest('.nav-group')?.classList.add('open');

    const url = new URL(location.href);
    url.searchParams.set('module', page);
    history.replaceState(null, '', url);

    if (state.systemTimer) {
      clearInterval(state.systemTimer);
      state.systemTimer = null;
    }

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
    if (mod && titles[mod]) return mod;
    return 'dashboard';
  }

  function kpiCard({ label, value, color, icon, pct }) {
    return `
      <div class="kpi-card">
        <div class="kpi-top">
          <div>
            <div class="kpi-label">${esc(label)}</div>
            <div class="kpi-value">${esc(value)}</div>
          </div>
          <div class="kpi-icon ${color}"><i class="fa-solid ${icon}"></i></div>
        </div>
        <div class="kpi-bar ${color}" style="--w:${Math.max(8, Math.min(100, pct || 40))}%"><span></span></div>
      </div>
    `;
  }

  function drawCpuChart(canvas, routers, cloud) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 520;
    const h = 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const labels = [];
    const values = [];
    if (routers?.length) {
      routers.filter((r) => r.online).forEach((r) => {
        const n = Math.max(1, r.cpu_count || 1);
        for (let i = 1; i <= Math.min(n, 8); i++) {
          labels.push('CPU' + i);
          // approximate per-core from overall load
          values.push(Math.max(0, Math.min(100, Number(r.cpu_load) + (i - 1) * 2)));
        }
        labels.push('ALL');
        values.push(Number(r.cpu_load) || 0);
      });
    }
    if (!labels.length && cloud) {
      const n = Math.min(cloud.cpu_count || 4, 8);
      for (let i = 1; i <= n; i++) {
        labels.push('CPU' + i);
        values.push(Math.min(100, Math.round((cloud.load || 0) * 25) + i));
      }
      labels.push('ALL');
      values.push(Math.min(100, Math.round((cloud.load || 0) * 40)));
    }
    if (!labels.length) {
      labels.push('CPU1', 'ALL');
      values.push(0, 0);
    }

    const pad = { t: 20, r: 16, b: 36, l: 36 };
    const chartW = w - pad.l - pad.r;
    const chartH = h - pad.t - pad.b;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '11px DM Sans, sans-serif';
    for (let y = 0; y <= 100; y += 25) {
      const yy = pad.t + chartH - (y / 100) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(pad.l + chartW, yy);
      ctx.stroke();
      ctx.fillText(String(y), 8, yy + 3);
    }

    const gap = 8;
    const barW = Math.max(10, (chartW - gap * labels.length) / labels.length);
    values.forEach((v, i) => {
      const x = pad.l + i * (barW + gap) + gap / 2;
      const bh = (v / 100) * chartH;
      const y = pad.t + chartH - bh;
      const grad = ctx.createLinearGradient(0, y, 0, pad.t + chartH);
      grad.addColorStop(0, '#60a5fa');
      grad.addColorStop(1, '#2563eb');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, bh);
      ctx.fillStyle = '#9aa3b2';
      ctx.save();
      ctx.translate(x + barW / 2, h - 10);
      ctx.rotate(-0.4);
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    });
  }

  // ── Dashboard ──
  async function loadDashboard() {
    const [stats, system] = await Promise.all([
      api('/dashboard'),
      api('/system').catch(() => null)
    ]);

    const salesMax = Math.max(
      1,
      Number(stats.sales.today.amount),
      Number(stats.sales.week.amount),
      Number(stats.sales.month.amount),
      Number(stats.sales.year?.amount || 0)
    );

    $('#sales-kpi-grid').innerHTML = [
      kpiCard({
        label: 'Daily',
        value: money(stats.sales.today.amount),
        color: 'blue',
        icon: 'fa-coins',
        pct: (stats.sales.today.amount / salesMax) * 100
      }),
      kpiCard({
        label: 'Weekly',
        value: money(stats.sales.week.amount),
        color: 'green',
        icon: 'fa-coins',
        pct: (stats.sales.week.amount / salesMax) * 100
      }),
      kpiCard({
        label: 'Monthly',
        value: money(stats.sales.month.amount),
        color: 'yellow',
        icon: 'fa-coins',
        pct: (stats.sales.month.amount / salesMax) * 100
      }),
      kpiCard({
        label: 'Yearly',
        value: money(stats.sales.year?.amount || 0),
        color: 'red',
        icon: 'fa-coins',
        pct: ((stats.sales.year?.amount || 0) / salesMax) * 100
      })
    ].join('');

    $('#user-kpi-grid').innerHTML = [
      kpiCard({
        label: 'Hotspot Active',
        value: String(stats.active_sessions),
        color: 'blue',
        icon: 'fa-wifi',
        pct: Math.min(100, stats.active_sessions * 5 || 8)
      }),
      kpiCard({
        label: 'Hotspot Total User',
        value: String(stats.total_users || 0),
        color: 'green',
        icon: 'fa-wifi',
        pct: Math.min(100, (stats.total_users || 0) / 10 || 8)
      }),
      kpiCard({
        label: 'Devices Online',
        value: `${stats.devices_online} / ${stats.devices_total}`,
        color: 'yellow',
        icon: 'fa-microchip',
        pct: stats.devices_total
          ? (stats.devices_online / stats.devices_total) * 100
          : 8
      }),
      kpiCard({
        label: 'Vendos',
        value: String(stats.vendos),
        color: 'red',
        icon: 'fa-store',
        pct: Math.min(100, stats.vendos * 15 || 8)
      })
    ].join('');

    $('#today-sales-detail').innerHTML = `
      <div><strong>${money(stats.sales.today.amount)}</strong> today · ${stats.sales.today.coins} coins · ${stats.sales.today.txns} txns</div>
      <div>Week: <strong>${money(stats.sales.week.amount)}</strong></div>
      <div>Month: <strong>${money(stats.sales.month.amount)}</strong></div>
      <div>Year: <strong>${money(stats.sales.year?.amount || 0)}</strong></div>
      <div style="margin-top:10px">Paused sessions: ${stats.paused_sessions || 0} · Unused vouchers: ${stats.unused_vouchers}</div>
    `;

    $('#traffic-summary').innerHTML = `
      <div>Active hotspot sessions: <strong>${stats.active_sessions}</strong></div>
      <div>CENTRAL captive portal gateway: <strong>10.0.0.1</strong></div>
    `;

    renderSystem(system);
    state.systemTimer = setInterval(async () => {
      try {
        renderSystem(await api('/system'));
      } catch {}
    }, 15000);
  }

  function renderSystem(system) {
    const wrap = $('#resource-cards');
    if (!wrap) return;
    if (!system) {
      wrap.innerHTML = '<p class="empty">System monitor unavailable.</p>';
      return;
    }

    const cards = [];
    (system.routers || []).forEach((r) => {
      if (!r.online) {
        cards.push(`
          <div class="resource-card">
            <h4>${esc(r.name)} · ${esc(r.host)}</h4>
            <p class="empty" style="padding:8px 0">Offline — ${esc(r.error || 'unreachable')}</p>
          </div>
        `);
        return;
      }
      cards.push(`
        <div class="resource-card">
          <h4>${esc(r.identity || r.name)} · ${esc(r.board)}</h4>
          <div class="res-row">
            <span class="label">CPU Load</span>
            <div class="res-track blue"><span style="width:${r.cpu_load}%"></span></div>
            <span>${r.cpu_load}%</span>
          </div>
          <div class="res-row">
            <span class="label">Free Memory</span>
            <div class="res-track red"><span style="width:${r.memory.used_pct}%"></span></div>
            <span>${fmtBytes(r.memory.total - r.memory.free)} / ${fmtBytes(r.memory.total)}</span>
          </div>
          <div class="res-row">
            <span class="label">Free HDD</span>
            <div class="res-track green"><span style="width:${r.hdd.used_pct}%"></span></div>
            <span>${fmtBytes(r.hdd.total - r.hdd.free)} / ${fmtBytes(r.hdd.total)}</span>
          </div>
          <div class="res-meta">
            <span>Temp: ${r.temperature != null ? esc(r.temperature) + '°' : 'N/A'}</span>
            <span>Uptime: ${esc(r.uptime)}</span>
            <span>${esc(r.version)}</span>
          </div>
        </div>
      `);
    });

    if (system.cloud) {
      const c = system.cloud;
      cards.push(`
        <div class="resource-card">
          <h4>Cloud · ${esc(c.hostname)}</h4>
          <div class="res-row">
            <span class="label">Load</span>
            <div class="res-track blue"><span style="width:${Math.min(100, (c.load || 0) * 25)}%"></span></div>
            <span>${Number(c.load || 0).toFixed(2)}</span>
          </div>
          <div class="res-row">
            <span class="label">Free Memory</span>
            <div class="res-track red"><span style="width:${c.memory.used_pct}%"></span></div>
            <span>${fmtBytes(c.memory.total - c.memory.free)} / ${fmtBytes(c.memory.total)}</span>
          </div>
          <div class="res-meta">
            <span>CPUs: ${c.cpu_count}</span>
            <span>Uptime: ${fmtUptime(c.uptime)}</span>
          </div>
        </div>
      `);
    }

    wrap.innerHTML = cards.join('') || '<p class="empty">Walang router pa.</p>';
    drawCpuChart($('#cpu-chart'), system.routers, system.cloud);
    const stamp = $('#monitor-stamp');
    if (stamp) {
      stamp.textContent = new Date(system.stamped_at || Date.now()).toLocaleString('en-PH');
    }
  }

  $$('.monitor-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.monitor-tab').forEach((t) => t.classList.toggle('active', t === tab));
      ['system', 'sales', 'traffic'].forEach((name) => {
        $('#mon-' + name)?.classList.toggle('hidden', tab.dataset.monTab !== name);
      });
    });
  });

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

  $('#detail-close')?.addEventListener('click', () => $('#vendo-detail-dialog').close());
  $('#btn-new-vendo')?.addEventListener('click', () => {
    $('#vendo-form').reset();
    $('#vendo-dialog').showModal();
  });
  $('#vendo-cancel')?.addEventListener('click', () => $('#vendo-dialog').close());

  $('#vendo-form')?.addEventListener('submit', async (e) => {
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
  $('#btn-refresh-devices')?.addEventListener('click', () => loadDevices());

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

  // ── Hotspot Server / Profile ──
  function setHsTab(tab) {
    $$('.hs-tab').forEach((t) => t.classList.toggle('active', t.dataset.hsTab === tab));
    $('#hs-server-panel').classList.toggle('hidden', tab !== 'server');
    $('#hs-profile-panel').classList.toggle('hidden', tab !== 'profile');
    $('#hs-toolbar-text').textContent = tab === 'server'
      ? 'Add/Edit/Delete Hotspot Server — auto sync sa MikroTik.'
      : 'Add/Edit/Delete Profile — auto sync sa MikroTik user profile.';
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
        <thead><tr><th>Name</th><th>Vendo</th><th>Interface IP</th><th>Parent IF</th><th>VLANs</th><th>Last push</th><th>Action</th></tr></thead>
        <tbody>
          ${servers.servers.map((s) => `
            <tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${esc(s.site_name || '—')}</td>
              <td class="mono">${esc(s.hs_address)}</td>
              <td>${esc(s.interface_name || '—')}</td>
              <td>${Number(s.vlan_id) === 0 ? esc(s.vlan_ids || 'ALL') : esc(s.vlan_id)}</td>
              <td class="mono">${esc(s.last_pushed_at || '—')}</td>
              <td>
                <button class="btn-primary" data-hs-push="${s.id}">Push</button>
                <button class="btn-secondary" data-hs-edit="${s.id}">Edit</button>
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
                <button class="btn-primary" data-profile-push="${p.id}">Push</button>
                <button class="btn-secondary" data-profile-script="${p.id}">Script</button>
                <button class="btn-danger" data-profile-del="${p.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">Walang profile pa. Mag-click + Profile.</p>';

    $$('[data-hs-push]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await api('/hotspot/servers/' + btn.dataset.hsPush + '/push', { method: 'POST' });
          alert('MikroTik OK\n\nProfile: ' + (r.hotspot_address || '10.0.0.1') + '\nInterface: ' + (r.gateway || '') + '\n\n' + (r.steps || []).join('\n'));
          loadHotspotServer();
        } catch (ex) {
          alert('Push failed: ' + ex.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
    $$('[data-hs-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const s = servers.servers.find((x) => x.id === btn.dataset.hsEdit);
        if (!s) return;
        await openServerDialog(s);
      });
    });
    $$('[data-hs-script]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await api('/hotspot/servers/' + btn.dataset.hsScript + '/script');
        alert(r.script);
      });
    });
    $$('[data-hs-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete sa system at sa MikroTik ang hotspot server na ito?\n\nTatanggalin: hotspot, DHCP, IP, VLAN interface.')) return;
        btn.disabled = true;
        try {
          const r = await api('/hotspot/servers/' + btn.dataset.hsDel, { method: 'DELETE' });
          alert('Na-delete sa system at MikroTik:\n\n' + (r.mikrotik?.steps || []).join('\n'));
          loadHotspotServer();
        } catch (ex) {
          alert('Hindi na-delete — ' + ex.message + '\n\nNaka-stay pa rin sa system at MikroTik.');
        } finally {
          btn.disabled = false;
        }
      });
    });
    $$('[data-profile-push]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await api('/hotspot/profiles/' + btn.dataset.profilePush + '/push', { method: 'POST' });
          alert('Profile pushed: ' + (r.profile || 'OK'));
        } catch (ex) {
          alert('Push failed: ' + ex.message);
        } finally {
          btn.disabled = false;
        }
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
        if (!confirm('Delete sa system at sa MikroTik ang profile na ito?')) return;
        try {
          const r = await api('/hotspot/profiles/' + btn.dataset.profileDel, { method: 'DELETE' });
          if (r.mikrotik) {
            alert('Deleted\n\nMikroTik:\n' + (r.mikrotik.steps || []).join('\n'));
          }
          loadHotspotServer();
        } catch (ex) {
          alert('Delete failed: ' + ex.message);
        }
      });
    });
  }

  $$('.hs-tab').forEach((tab) => {
    tab.addEventListener('click', () => setHsTab(tab.dataset.hsTab));
  });

  $('#btn-refresh-hs')?.addEventListener('click', () => loadHotspotServer());
  async function fillHsSiteSelect(selected) {
    if (!state.vendos.length) {
      const data = await api('/vendos');
      state.vendos = data.vendos;
    }
    const sel = $('#hs-site-select');
    if (!sel) return;
    const withMt = state.vendos.filter((v) => v.mikrotik_host);
    sel.innerHTML = '<option value="">— Pili ng vendo —</option>' +
      withMt.map((v) => `<option value="${v.id}">${esc(v.name)} (${esc(v.mikrotik_host)})</option>`).join('');
    if (selected) sel.value = selected;
    else if (withMt.length === 1) sel.value = withMt[0].id;
  }

  async function fillHsInterfaceSelect(selected, siteId) {
    const sel = $('#hs-interface-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Loading interfaces… —</option>';
    try {
      const q = siteId ? '?site_id=' + encodeURIComponent(siteId) : '';
      const data = await api('/hotspot/interfaces' + q);
      const opts = (data.interfaces || []).map((i) =>
        `<option value="${esc(i.name)}">${esc(i.name)}${i.type ? ' (' + esc(i.type) + ')' : ''}${i.running ? '' : ' [down]'}</option>`
      );
      sel.innerHTML = '<option value="">— Pili ng interface —</option>' + opts.join('');
      if (selected) sel.value = selected;
    } catch (ex) {
      sel.innerHTML = '<option value="">— Hindi mabasa ang MikroTik —</option>';
      if (selected) sel.innerHTML += `<option value="${esc(selected)}">${esc(selected)}</option>`;
      if (selected) sel.value = selected;
    }
  }

  function suggestInterfaceFromVlan() {
    const form = $('#hs-server-form');
    if (!form || $('#hs-server-id').value) return;
    const vid = Number(form.elements.namedItem('vlan_id')?.value || 0);
    if (vid > 0) {
      form.elements.namedItem('name').value = 'VLAN' + vid;
      form.elements.namedItem('vlan_ids').value = String(vid);
    }
  }

  async function openServerDialog(server) {
    await fillHsSiteSelect(server?.site_id || '');
    const form = $('#hs-server-form');
    $('#hs-server-dialog-title').textContent = server?.id ? 'Edit Hotspot Server' : 'Setup Hotspot Server';
    const siteId = server?.site_id || form.elements.namedItem('site_id')?.value || '';
    await fillHsInterfaceSelect(server?.interface_name || '', siteId);
    if (server) {
      $('#hs-server-id').value = server.id;
      for (const k of ['name', 'hs_address', 'vlan_id', 'vlan_ids', 'profile_name', 'html_directory', 'login_by', 'dns_name']) {
        const el = form.elements.namedItem(k);
        if (el && server[k] != null) el.value = server[k];
      }
      if (form.elements.namedItem('site_id')) form.elements.namedItem('site_id').value = server.site_id || '';
      if (server.interface_name) $('#hs-interface-select').value = server.interface_name;
    } else {
      form.reset();
      $('#hs-server-id').value = '';
      form.elements.namedItem('name').value = 'VLAN530';
      form.elements.namedItem('hs_address').value = '10.5.30.1';
      form.elements.namedItem('vlan_id').value = '530';
      form.elements.namedItem('vlan_ids').value = '530';
      await fillHsInterfaceSelect('ether2-OUT', siteId);
    }
    if (form.elements.namedItem('push_to_mikrotik')) form.elements.namedItem('push_to_mikrotik').checked = true;
    $('#hs-server-dialog').showModal();
  }

  $('#hs-site-select')?.addEventListener('change', (e) => {
    fillHsInterfaceSelect($('#hs-interface-select')?.value || '', e.target.value);
  });
  $('#hs-server-form')?.elements.namedItem('vlan_id')?.addEventListener('change', suggestInterfaceFromVlan);
  $('#hs-server-form')?.elements.namedItem('vlan_ids')?.addEventListener('change', suggestInterfaceFromVlan);

  $('#btn-add-server')?.addEventListener('click', async () => {
    setHsTab('server');
    await openServerDialog(null);
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
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    body.vlan_id = Number(body.vlan_id || 0);
    body.push_to_mikrotik = true;
    delete body.id;

    if (!body.site_id) {
      alert('Pili ng Vendo site — kailangan para sa MikroTik sync.');
      return;
    }
    if (!body.interface_name) {
      alert('Pili ng Parent Interface (hal. ether2-OUT).');
      return;
    }

    const id = $('#hs-server-id').value;
    if (submitBtn) submitBtn.disabled = true;
    try {
      const data = id
        ? await api('/hotspot/servers/' + id, { method: 'PUT', body: JSON.stringify(body) })
        : await api('/hotspot/servers', { method: 'POST', body: JSON.stringify(body) });

      $('#hs-server-dialog').close();

      if (data.push?.success) {
        alert(
          'Na-save at na-push sa MikroTik\n\n' +
          'VLAN/Interface: ' + (data.push.interface || '—') + '\n' +
          'Client IP: ' + (data.push.gateway || body.hs_address) + '\n' +
          'Portal: ' + (data.push.hotspot_address || '10.0.0.1') + '\n\n' +
          (data.push.steps || []).join('\n')
        );
      } else if (data.push) {
        alert('Na-save sa system pero hindi na-push sa MikroTik:\n' + (data.push.error || 'unknown error'));
      } else if (!id) {
        alert('Na-create at na-sync sa MikroTik.');
      } else {
        alert('Na-save.');
      }
      loadHotspotServer();
    } catch (ex) {
      alert((id ? 'Hindi na-save' : 'Hindi na-create') + ' — ' + ex.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  $('#hs-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.shared_users = Number(body.shared_users || 1);
    body.pause_on_disconnect = fd.get('pause_on_disconnect') ? 1 : 0;
    body.no_validity = fd.get('no_validity') ? 1 : 0;
    body.allow_random_mac = fd.get('allow_random_mac') ? 1 : 0;
    body.push_to_mikrotik = fd.get('push_to_mikrotik') ? true : false;
    const data = await api('/hotspot/profiles', { method: 'POST', body: JSON.stringify(body) });
    $('#hs-profile-dialog').close();
    if (data.push?.success) {
      alert('Profile saved & pushed sa MikroTik: ' + (data.push.profile || data.profile.name));
    } else if (data.push) {
      alert('Saved pero MikroTik push failed:\n' + (data.push.error || 'unknown'));
    } else if (data.script) {
      alert('Profile created.\n\nMikroTik script:\n' + data.script);
    }
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

  $('#btn-gen-voucher')?.addEventListener('click', async () => {
    if (!state.vendos.length) {
      const data = await api('/vendos');
      state.vendos = data.vendos;
    }
    const sel = $('#voucher-site');
    sel.innerHTML = state.vendos.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
    $('#voucher-dialog').showModal();
  });
  $('#voucher-cancel')?.addEventListener('click', () => $('#voucher-dialog').close());

  $('#voucher-form')?.addEventListener('submit', async (e) => {
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
  $('#btn-load-report')?.addEventListener('click', () => loadReports());

  boot();
})();
