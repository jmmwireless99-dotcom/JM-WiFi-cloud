(function () {
  'use strict';

  const API = window.EB_API_BASE || '/api/empty-bottle/admin';
  const state = { token: localStorage.getItem('jm_token') || '', operator: null, site: null, systemTimer: null, page: 'dashboard' };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(API + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(false); throw new Error(data.error || 'Unauthorized'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  const money = (n) => '₱ ' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBytes = (n) => {
    const v = Number(n || 0);
    if (v >= 1024 ** 3) return (v / 1024 ** 3).toFixed(2) + ' GiB';
    if (v >= 1024 ** 2) return (v / 1024 ** 2).toFixed(2) + ' MiB';
    return (v / 1024).toFixed(1) + ' KiB';
  };

  function tickClock() {
    const el = $('#header-clock');
    if (el) el.textContent = new Date().toLocaleString('en-PH', { month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }

  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#op-name').textContent = state.operator.name + ' · ' + state.operator.role;
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
    showLogin();
  }

  async function boot() {
    if (!state.token) { showLogin(); return; }
    try {
      const data = await api('/me');
      state.operator = data.operator;
      showApp();
      navigate('dashboard');
    } catch { showLogin(); }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value })
      });
      state.token = data.token;
      state.operator = data.operator;
      localStorage.setItem('jm_token', data.token);
      showApp();
      navigate('dashboard');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#logout-btn')?.addEventListener('click', () => logout());
  $('#btn-sidebar-toggle')?.addEventListener('click', () => $('#app-view').classList.toggle('sidebar-collapsed'));
  $('#btn-refresh-page')?.addEventListener('click', () => navigate(state.page));

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.nav-item[data-page]');
    if (nav) navigate(nav.dataset.page);
  });

  const titles = { dashboard: 'Dashboard', sales: 'Sales', machines: 'Machines', network: 'MikroTik / VLAN', settings: 'Site Settings' };

  async function navigate(page) {
    state.page = page;
    $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    $('#page-title').textContent = titles[page] || page;
    $('#page-breadcrumb').textContent = 'Empty Bottle / ' + (titles[page] || page);
    if (state.systemTimer) { clearInterval(state.systemTimer); state.systemTimer = null; }
    const loaders = { dashboard: loadDashboard, sales: loadSales, machines: loadMachines, network: loadNetwork, settings: loadSettings };
    if (loaders[page]) await loaders[page]();
  }

  function kpiCard({ label, value, color, icon, pct }) {
    return `<div class="kpi-card"><div class="kpi-top"><div><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div></div><div class="kpi-icon ${color}"><i class="fa-solid ${icon}"></i></div></div><div class="kpi-bar ${color}" style="--w:${Math.max(8, Math.min(100, pct || 40))}%"><span></span></div></div>`;
  }

  function drawCpuChart(canvas, routers, cloud) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth || 520;
    const h = 220;
    canvas.width = w * 2; canvas.height = h * 2;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);
    const labels = [];
    const values = [];
    (routers || []).filter((r) => r.online).forEach((r) => {
      labels.push('ALL');
      values.push(Number(r.cpu_load) || 0);
    });
    if (!labels.length && cloud) { labels.push('ALL'); values.push(Math.min(100, Math.round((cloud.load || 0) * 40))); }
    if (!labels.length) { labels.push('ALL'); values.push(0); }
    const pad = { t: 20, r: 16, b: 36, l: 36 };
    const chartW = w - pad.l - pad.r;
    const chartH = h - pad.t - pad.b;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '11px DM Sans, sans-serif';
    for (let y = 0; y <= 100; y += 25) {
      const yy = pad.t + chartH - (y / 100) * chartH;
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + chartW, yy); ctx.stroke();
      ctx.fillText(String(y), 8, yy + 3);
    }
    const barW = Math.max(20, (chartW - 20) / labels.length);
    values.forEach((v, i) => {
      const x = pad.l + i * (barW + 8);
      const bh = (v / 100) * chartH;
      const grad = ctx.createLinearGradient(0, pad.t + chartH - bh, 0, pad.t + chartH);
      grad.addColorStop(0, '#fb923c');
      grad.addColorStop(1, '#ea580c');
      ctx.fillStyle = grad;
      ctx.fillRect(x, pad.t + chartH - bh, barW, bh);
      ctx.fillStyle = '#9aa3b2';
      ctx.fillText(labels[i], x + barW / 2 - 12, h - 10);
    });
  }

  function renderSystem(system) {
    const wrap = $('#resource-cards');
    if (!wrap || !system) return;
    const cards = (system.routers || []).map((r) => {
      if (!r.online) return `<div class="resource-card"><h4>${esc(r.name)}</h4><p class="empty" style="padding:8px 0">Offline — ${esc(r.error || '')}</p></div>`;
      return `<div class="resource-card"><h4>${esc(r.identity || r.name)} · VLAN${r.vlan_id || 103}</h4>
        <div class="res-row"><span class="label">CPU</span><div class="res-track blue"><span style="width:${r.cpu_load}%"></span></div><span>${r.cpu_load}%</span></div>
        <div class="res-row"><span class="label">Memory</span><div class="res-track red"><span style="width:${r.memory.used_pct}%"></span></div><span>${fmtBytes(r.memory.total - r.memory.free)} / ${fmtBytes(r.memory.total)}</span></div>
        <div class="res-meta"><span>VLAN OK: ${r.vlan_configured ? 'yes' : 'check'}</span><span>Uptime: ${esc(r.uptime)}</span></div></div>`;
    }).join('');
    wrap.innerHTML = cards || '<p class="empty">Walang router.</p>';
    drawCpuChart($('#cpu-chart'), system.routers, system.cloud);
    const stamp = $('#monitor-stamp');
    if (stamp) stamp.textContent = new Date(system.stamped_at || Date.now()).toLocaleString('en-PH');
  }

  async function loadDashboard() {
    const [stats, system, siteData] = await Promise.all([
      api('/dashboard'),
      api('/system').catch(() => null),
      api('/site').catch(() => null)
    ]);
    state.site = siteData?.site;
    const max = Math.max(1, stats.sales.today.amount, stats.sales.week.amount, stats.sales.month.amount, stats.sales.year?.amount || 0);
    $('#sales-kpi-grid').innerHTML = [
      kpiCard({ label: 'Daily', value: money(stats.sales.today.amount), color: 'blue', icon: 'fa-coins', pct: stats.sales.today.amount / max * 100 }),
      kpiCard({ label: 'Weekly', value: money(stats.sales.week.amount), color: 'green', icon: 'fa-coins', pct: stats.sales.week.amount / max * 100 }),
      kpiCard({ label: 'Monthly', value: money(stats.sales.month.amount), color: 'yellow', icon: 'fa-coins', pct: stats.sales.month.amount / max * 100 }),
      kpiCard({ label: 'Yearly', value: money(stats.sales.year?.amount || 0), color: 'red', icon: 'fa-coins', pct: (stats.sales.year?.amount || 0) / max * 100 })
    ].join('');
    $('#user-kpi-grid').innerHTML = [
      kpiCard({ label: 'Machines Online', value: `${stats.devices_online} / ${stats.devices_total}`, color: 'blue', icon: 'fa-microchip', pct: stats.devices_total ? stats.devices_online / stats.devices_total * 100 : 8 }),
      kpiCard({ label: 'VLAN', value: String(siteData?.site?.vlan_id || 103), color: 'green', icon: 'fa-network-wired', pct: 100 }),
      kpiCard({ label: 'Gateway', value: siteData?.network?.hs_address || '10.0.3.1', color: 'yellow', icon: 'fa-server', pct: 80 }),
      kpiCard({ label: 'Site', value: siteData?.site?.name || 'Empty Bottle', color: 'red', icon: 'fa-bottle-water', pct: 60 })
    ].join('');
    $('#network-summary').innerHTML = `
      <div><strong>VLAN${siteData?.site?.vlan_id || 103}</strong> · gateway <strong>${siteData?.network?.hs_address || '10.0.3.1'}</strong></div>
      <div>Bridge: <code>${siteData?.network?.interface_name || 'bridge-empty-bottle'}</code></div>
      <div>MikroTik: <code>${esc(siteData?.site?.mikrotik_host || '—')}</code></div>
      <div style="margin-top:8px;color:var(--muted)">Hiwalay sa Cloud Hotspot CENTRAL 10.0.0.1</div>`;
    renderSystem(system);
    state.systemTimer = setInterval(() => api('/system').then(renderSystem).catch(() => {}), 15000);
  }

  $$('.monitor-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.monitor-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#mon-system')?.classList.toggle('hidden', tab.dataset.monTab !== 'system');
      $('#mon-network')?.classList.toggle('hidden', tab.dataset.monTab !== 'network');
    });
  });

  async function loadSales() {
    const data = await api('/sales');
    if (!data.sales.length) { $('#sales-list').innerHTML = '<p class="empty">Walang sales pa.</p>'; return; }
    $('#sales-list').innerHTML = `<table><thead><tr><th>Time</th><th>Device</th><th>Coins</th><th>Amount</th><th>Minutes</th></tr></thead><tbody>
      ${data.sales.map((s) => `<tr><td>${esc(s.created_at)}</td><td>${esc(s.device_name || '—')}</td><td>${s.coins}</td><td>${money(s.amount)}</td><td>${s.minutes_granted}</td></tr>`).join('')}
    </tbody></table>`;
  }

  async function loadMachines() {
    const data = await api('/devices');
    if (!data.devices.length) { $('#device-list').innerHTML = '<p class="empty">Walang machines pa. I-register ang ESP8266 sa cloud API.</p>'; return; }
    $('#device-list').innerHTML = `<table><thead><tr><th>Name</th><th>Type</th><th>MAC</th><th>Status</th><th>Last seen</th></tr></thead><tbody>
      ${data.devices.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.device_type)}</td><td class="mono">${esc(d.mac_address || '—')}</td><td><span class="badge ${d.status}">${esc(d.status)}</span></td><td>${esc(d.last_seen || '—')}</td></tr>`).join('')}
    </tbody></table>`;
  }
  $('#btn-refresh-devices')?.addEventListener('click', () => loadMachines());

  async function loadNetwork() {
    const data = await api('/site');
    const n = data.network;
    const s = data.site;
    $('#network-detail').innerHTML = `
      <div>Site: <strong>${esc(s.name)}</strong></div>
      <div>VLAN: <strong>${s.vlan_id || 103}</strong></div>
      <div>Gateway: <strong>${n?.hs_address || '10.0.3.1'}/24</strong></div>
      <div>Bridge: <code>${esc(n?.interface_name || 'bridge-empty-bottle')}</code></div>
      <div>DHCP pool: <code>10.0.3.10–254</code></div>
      <div>MikroTik host: <code>${esc(s.mikrotik_host || '—')}</code></div>`;
    const scriptData = await api('/network/script');
    $('#btn-show-script').onclick = () => {
      const box = $('#network-script');
      box.textContent = scriptData.script;
      box.classList.toggle('hidden');
    };
  }

  async function loadSettings() {
    const data = await api('/site');
    const s = data.site;
    const form = $('#site-form');
    for (const [k, v] of Object.entries(s)) {
      const el = form.elements.namedItem(k);
      if (el && v != null) el.value = v;
    }
    form.elements.namedItem('id').value = s.id;
    $('#site-api-info').innerHTML = `
      <dt>Site ID</dt><dd class="mono">${esc(s.id)}</dd>
      <dt>API Key</dt><dd class="mono">${esc(s.api_key)}</dd>
      <dt>Module</dt><dd>empty_bottle</dd>`;
  }

  $('#site-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.vlan_id = Number(body.vlan_id);
    if (!body.mikrotik_pass) delete body.mikrotik_pass;
    await api('/site', { method: 'PUT', body: JSON.stringify(body) });
    alert('Saved.');
    loadSettings();
  });

  boot();
})();
