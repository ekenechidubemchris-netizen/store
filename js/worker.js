/* ===================================================
   KENECART - worker.js
   Worker authentication, Role-Based Access Control,
   and the full worker dashboard (staff, products,
   inventory, orders, customers, reports, etc).
   =================================================== */

const WORKER_SESSION_KEY = 'kc_worker_session';
const WORKERS_KEY = 'kc_workers';
const WORKERS_SEED_VERSION_KEY = 'kc_workers_seed_version';
const WORKERS_SEED_VERSION = '3'; // bump this whenever the seeded roster changes, to force re-seeding in browsers with stale cached data

/* Roles authorized for full worker/system management (RBAC Level 1) */
const LEVEL1_ROLES = [
  'Super Administrator', 'Chief Executive Officer (CEO)', 'Chief Operating Officer (COO)',
  'General Store Manager', 'Human Resources Manager', 'IT/System Administrator'
];

/* ---------- Seed / load workers ---------- */
async function ensureWorkersSeeded() {
  const cachedVersion = localStorage.getItem(WORKERS_SEED_VERSION_KEY);
  let workers = JSON.parse(localStorage.getItem(WORKERS_KEY) || 'null');
  if (workers && cachedVersion === WORKERS_SEED_VERSION) return workers;
  try {
    const res = await fetch('data/workers.json');
    workers = await res.json();
  } catch (e) {
    workers = window.KC_FALLBACK_WORKERS || [];
  }
  localStorage.setItem(WORKERS_KEY, JSON.stringify(workers));
  localStorage.setItem(WORKERS_SEED_VERSION_KEY, WORKERS_SEED_VERSION);
  return workers;
}
function getWorkers() { return JSON.parse(localStorage.getItem(WORKERS_KEY) || '[]'); }
function saveWorkers(list) { localStorage.setItem(WORKERS_KEY, JSON.stringify(list)); }
function resetDemoData() {
  if (!confirm('This will erase any staff/customer changes made in this browser and restore the default demo data. Continue?')) return;
  localStorage.removeItem(WORKERS_KEY);
  localStorage.removeItem(WORKERS_SEED_VERSION_KEY);
  localStorage.removeItem('kc_store_config');
  showToastSafe('Demo data reset. Reloading…', 'success');
  setTimeout(() => location.reload(), 800);
}

function getWorkerSession() { return JSON.parse(localStorage.getItem(WORKER_SESSION_KEY) || 'null'); }
function setWorkerSession(w) {
  localStorage.setItem(WORKER_SESSION_KEY, JSON.stringify({ employeeId: w.employeeId, fullName: w.fullName, role: w.role, level: w.level, department: w.department }));
}
function clearWorkerSession() { localStorage.removeItem(WORKER_SESSION_KEY); }

/* ---------- RBAC helpers ---------- */
function isLevel1(session) { return session && (session.level === 1 || LEVEL1_ROLES.includes(session.role)); }
function canManageStaff(session) { return isLevel1(session); }
function canManageDeptOnly(session) { return session && session.level === 2; }
function isReadOnly(session) { return session && session.level >= 5; }

/* ---------- Login ---------- */
async function handleWorkerLogin(e) {
  e.preventDefault();
  await ensureWorkersSeeded();
  const form = e.target;
  const empId = form.employeeId.value.trim().toUpperCase();
  const password = form.password.value;
  const errorBox = document.getElementById('workerLoginError');
  errorBox.classList.add('d-none');

  const workers = getWorkers();
  const worker = workers.find(w => w.employeeId.toUpperCase() === empId);

  if (!worker || worker.password !== password) {
    errorBox.textContent = 'Invalid Employee ID or password.';
    errorBox.classList.remove('d-none');
    return;
  }
  if (worker.status === 'Suspended') {
    errorBox.textContent = 'This account has been suspended. Contact your administrator.';
    errorBox.classList.remove('d-none');
    return;
  }
  setWorkerSession(worker);
  showToastSafe(`Welcome, ${worker.fullName.split(' ')[0]}`, 'success');
  navigateTo('worker-dashboard');
}

function workerLogout() {
  clearWorkerSession();
  navigateTo('home');
}

/* ---------- Dashboard bootstrap ---------- */
async function initWorkerDashboard() {
  const session = getWorkerSession();
  if (!session) { navigateTo('worker-login'); return; }
  await ensureWorkersSeeded();

  document.getElementById('wSidebarName').textContent = session.fullName;
  document.getElementById('wSidebarRole').textContent = session.role;
  document.getElementById('wSidebarAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(session.fullName)}&background=2563EB&color=fff`;

  applySidebarRBAC(session);

  // Guard against opening the dashboard before product data has finished loading
  const waitForProducts = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(waitForProducts);
      showDashSection('overview', session);
      updateWorkerNotifBadge(session);
    }
  }, 50);
}

function applySidebarRBAC(session) {
  const staffLink = document.getElementById('navStaff');
  if (staffLink && !canManageStaff(session) && !canManageDeptOnly(session)) {
    // Level 3/4/5 can still view basic staff directory but not manage — leave visible, gate actions inside the section instead.
  }
}

/* ---------- Section switcher ---------- */
function showDashSection(name, session) {
  console.log('[KeneCart] showDashSection called with:', name);
  session = session || getWorkerSession();
  if (!session) { console.warn('[KeneCart] No worker session found — cannot show section', name); return; }
  document.querySelectorAll('.dash-nav .nav-link').forEach(el => el.classList.remove('active'));
  const activeLink = document.getElementById('nav' + capitalize(name));
  if (activeLink) activeLink.classList.add('active');

  const content = document.getElementById('dashContent');
  const renderers = {
    overview: renderOverview, products: renderWorkerProducts, categories: renderCategories,
    inventory: renderInventory, orders: renderWorkerOrders, customers: renderWorkerCustomers,
    staff: renderStaff, departments: renderDepartments, reports: renderReports, sales: renderSales,
    suppliers: renderSuppliers, deliveries: renderDeliveries, finance: renderFinance,
    marketing: renderMarketing, messages: renderMessages, notifications: renderNotifications,
    settings: renderSettings, profile: renderWorkerProfile
  };
  const fn = renderers[name] || renderOverview;
  try {
    content.innerHTML = fn(session);
    attachSectionHandlers(name, session);
    console.log('[KeneCart] Section rendered successfully:', name);
  } catch (err) {
    console.error('[KeneCart] ERROR rendering section', name, ':', err);
    content.innerHTML = `<div class="dash-card"><p class="text-danger">Something went wrong loading this section: ${err.message}</p><p class="rbac-note">Press F12, click Console, and screenshot the red error for support.</p></div>`;
  }
  // Collapse sidebar on mobile after nav
  document.getElementById('dashSidebar')?.classList.remove('show');
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------- Overview / Dashboard ---------- */
function renderOverview(session) {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const products = KC.products || [];
  const workers = getWorkers();
  const revenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const today = new Date().toDateString();
  const todaysOrders = orders.filter(o => new Date(o.date).toDateString() === today);
  const todaysSales = todaysOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const lowStock = products.filter(p => p.stock > 0 && p.stock < 15).length;
  const recentOrders = orders.slice().reverse().slice(0, 6);

  setTimeout(() => drawSalesChart(orders), 0);
  setTimeout(() => drawCategoryChart(products), 0);
  setTimeout(() => drawSalesTrendChart(orders, KC.salesChartPeriod || 'day'), 0);

  return `
    <h1 class="dash-section-title">Welcome back, ${session.fullName.split(' ')[0]}</h1>
    <div class="row g-3 mb-4">
      <div class="col-6 col-lg-3">
        <div class="dash-card dash-stat-card d-flex align-items-center gap-3">
          <div class="icon-wrap" style="background:#22C55E22;color:#22C55E"><i class="bi bi-cash-coin"></i></div>
          <div><div class="value">$${todaysSales.toFixed(2)}</div><div class="label">Today's Sales</div></div>
        </div>
      </div>
      ${statCard('bi-cash-stack', '#2563EB', '$' + revenue.toFixed(2), 'Total Revenue')}
      ${statCard('bi-bag-check', '#F59E0B', orders.length, 'Total Orders')}
      ${statCard('bi-exclamation-triangle', '#EF4444', lowStock, 'Low Stock Items')}
    </div>

    <div class="row g-3 mb-4">
      <div class="col-12 col-lg-7">
        <div class="dash-card">
          <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <h2 class="fs-6 fw-bold mb-0">Sales Trend</h2>
            <div class="btn-group btn-group-sm" role="group" id="salesPeriodToggle">
              <button type="button" class="btn btn-outline-primary active" data-period="day" onclick="setSalesPeriod('day')">Day</button>
              <button type="button" class="btn btn-outline-primary" data-period="week" onclick="setSalesPeriod('week')">Week</button>
              <button type="button" class="btn btn-outline-primary" data-period="month" onclick="setSalesPeriod('month')">Month</button>
              <button type="button" class="btn btn-outline-primary" data-period="year" onclick="setSalesPeriod('year')">Year</button>
            </div>
          </div>
          <canvas id="salesTrendChart" class="dash-chart"></canvas>
        </div>
      </div>
      <div class="col-12 col-lg-5">
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-3">Sales by Category</h2>
          <canvas id="categoryChart" class="dash-chart"></canvas>
        </div>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-12">
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-3">Recent Orders</h2>
          ${recentOrders.length ? `<table class="table dash-table mb-0"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>${recentOrders.map(o => `<tr>
              <td>${o.id}</td><td>${o.customerName || o.shipping?.name || '—'}</td>
              <td>$${(o.total || 0).toFixed(2)}</td>
              <td><span class="dash-badge badge-active">${o.status || 'Processing'}</span></td>
            </tr>`).join('')}</tbody></table>` : '<p class="rbac-note">No orders placed yet.</p>'}
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-12 col-lg-6">
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-3">Revenue Trend</h2>
          <canvas id="salesChart" class="dash-chart"></canvas>
        </div>
      </div>
      <div class="col-12 col-lg-6">
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-3">Low Stock Products</h2>
          ${renderLowStockTable(products)}
        </div>
      </div>
    </div>
  `;
}
function statCard(icon, color, value, label) {
  return `
  <div class="col-6 col-lg-3">
    <div class="dash-card dash-stat-card d-flex align-items-center gap-3">
      <div class="icon-wrap" style="background:${color}22;color:${color}"><i class="bi ${icon}"></i></div>
      <div><div class="value">${value}</div><div class="label">${label}</div></div>
    </div>
  </div>`;
}
function renderLowStockTable(products) {
  const low = products.filter(p => p.stock < 15).sort((a, b) => a.stock - b.stock).slice(0, 6);
  if (!low.length) return '<p class="rbac-note">All products are well stocked.</p>';
  return `<table class="table dash-table mb-0"><tbody>
    ${low.map(p => `<tr><td>${p.name}</td><td class="text-end">
      <span class="dash-badge ${p.stock === 0 ? 'badge-out' : 'badge-low'}">${p.stock === 0 ? 'Out of stock' : p.stock + ' left'}</span>
    </td></tr>`).join('')}
  </tbody></table>`;
}
function renderOrdersTable(orders) {
  return `<table class="table dash-table mb-0"><tbody>
    ${orders.map(o => `<tr><td>${o.id}</td><td>${o.shipping?.name || '—'}</td><td class="text-end">$${o.total.toFixed(2)}</td></tr>`).join('')}
  </tbody></table>`;
}

/* Simple canvas line/bar charts (no external chart lib, per project constraints) */
function drawSalesChart(orders) {
  const canvas = document.getElementById('salesChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 240;

  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const totals = days.map(d => orders.filter(o => new Date(o.date).toDateString() === d.toDateString())
    .reduce((sum, o) => sum + o.total, 0));
  const max = Math.max(...totals, 10);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 20 + i * ((canvas.height - 40) / 4);
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(canvas.width - 10, y); ctx.stroke();
  }
  const stepX = (canvas.width - 50) / (totals.length - 1);
  ctx.beginPath(); ctx.strokeStyle = '#2563EB'; ctx.lineWidth = 2.5;
  totals.forEach((v, i) => {
    const x = 35 + i * stepX;
    const y = (canvas.height - 20) - (v / max) * (canvas.height - 40);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#F59E0B';
  totals.forEach((v, i) => {
    const x = 35 + i * stepX;
    const y = (canvas.height - 20) - (v / max) * (canvas.height - 40);
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#94A3B8'; ctx.font = '10px Inter';
  days.forEach((d, i) => {
    const x = 35 + i * stepX;
    ctx.fillText(d.toLocaleDateString(undefined, { weekday: 'short' }), x - 10, canvas.height - 4);
  });
}
function setSalesPeriod(period) {
  KC.salesChartPeriod = period;
  document.querySelectorAll('#salesPeriodToggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  drawSalesTrendChart(orders, period);
}

function drawSalesTrendChart(orders, period = 'day') {
  const canvas = document.getElementById('salesTrendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 240;

  // Build the list of period buckets + their labels, based on real order dates
  let buckets = []; // { start: Date, end: Date, label: string }
  const now = new Date();

  if (period === 'day') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const end = new Date(d); end.setDate(end.getDate() + 1);
      buckets.push({ start: d, end, label: d.toLocaleDateString(undefined, { weekday: 'short' }) });
    }
  } else if (period === 'week') {
    for (let i = 11; i >= 0; i--) {
      const end = new Date(now); end.setDate(end.getDate() - i * 7); end.setHours(23,59,59,999);
      const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
      buckets.push({ start, end, label: `W${12 - i}` });
    }
  } else if (period === 'month') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start: d, end, label: d.toLocaleDateString(undefined, { month: 'short' }) });
    }
  } else { // year
    for (let i = 4; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: String(y) });
    }
  }

  const totals = buckets.map(b => orders
    .filter(o => { const d = new Date(o.date); return d >= b.start && d < b.end; })
    .reduce((sum, o) => sum + (o.total || 0), 0));
  const max = Math.max(...totals, 10);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 20 + i * ((canvas.height - 40) / 4);
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(canvas.width - 10, y); ctx.stroke();
  }

  const barAreaWidth = canvas.width - 50;
  const barSlot = barAreaWidth / totals.length;
  const barWidth = Math.max(4, barSlot * 0.55);
  totals.forEach((v, i) => {
    const barHeight = (v / max) * (canvas.height - 40);
    const x = 35 + i * barSlot + (barSlot - barWidth) / 2;
    const y = (canvas.height - 20) - barHeight;
    const grad = ctx.createLinearGradient(0, y, 0, canvas.height - 20);
    grad.addColorStop(0, '#60A5FA');
    grad.addColorStop(1, '#2563EB');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barWidth, barHeight);
  });

  ctx.fillStyle = '#94A3B8'; ctx.font = '9px Inter';
  buckets.forEach((b, i) => {
    // Thin out labels if there are too many to avoid overlap
    if (totals.length > 14 && i % 2 !== 0) return;
    const x = 35 + i * barSlot + barSlot / 2;
    ctx.fillText(b.label, x - 12, canvas.height - 4);
  });
}
function drawCategoryChart(products) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 240;
  const cats = {};
  products.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
  const entries = Object.entries(cats);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const colors = ['#2563EB', '#F59E0B', '#22C55E', '#EF4444', '#A855F7', '#06B6D4'];
  let start = -Math.PI / 2;
  const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(cx, cy) - 20;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  entries.forEach(([, v], i) => {
    const angle = (v / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    start += angle;
  });
  // legend
  let ly = 10;
  entries.forEach(([name], i) => {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(canvas.width - 100, ly, 10, 10);
    ctx.fillStyle = '#E2E8F0'; ctx.font = '10px Inter';
    ctx.fillText(name, canvas.width - 84, ly + 9);
    ly += 16;
  });
}

/* ---------- Products management ---------- */
function renderWorkerProducts(session) {
  const canEdit = isLevel1(session) || canManageDeptOnly(session);
  const products = KC.products || [];
  return `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h1 class="dash-section-title mb-0">Products</h1>
      ${canEdit ? `<button class="btn btn-primary btn-sm" onclick="alert('Demo: opens Add Product form')"><i class="bi bi-plus-lg"></i> Add Product</button>` : ''}
    </div>
    <div class="dash-card">
      <div class="table-responsive">
        <table class="table dash-table align-middle">
          <thead><tr><th>Product</th><th>Brand</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th>${canEdit ? '<th>Actions</th>' : ''}</tr></thead>
          <tbody>
            ${products.map(p => `<tr>
              <td class="d-flex align-items-center gap-2"><img src="${p.image}" width="34" height="34" style="object-fit:cover;border-radius:6px">${p.name}</td>
              <td>${p.brand}</td><td>${p.category}</td><td>$${p.price.toFixed(2)}</td>
              <td>${stockBadge(p.stock)}</td>
              <td>${p.rating} ★</td>
              ${canEdit ? `<td>
                <button class="btn btn-sm btn-outline-light me-1" onclick="alert('Demo: edit ${escapeHTML(p.name)}')"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="alert('Demo: delete ${escapeHTML(p.name)}')"><i class="bi bi-trash"></i></button>
              </td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${!canEdit ? '<p class="rbac-note mt-2">Your role has view-only access to product management.</p>' : ''}
    </div>
  `;
}
function stockBadge(stock) {
  if (stock === 0) return `<span class="dash-badge badge-out">Out of stock</span>`;
  if (stock < 15) return `<span class="dash-badge badge-low">${stock} — Low</span>`;
  return `<span class="dash-badge badge-inStock">${stock} in stock</span>`;
}

function renderCategories() {
  const cats = [...new Set((KC.products || []).map(p => p.category))];
  return `
    <h1 class="dash-section-title">Categories</h1>
    <div class="row g-3">
      ${cats.map(c => {
        const count = KC.products.filter(p => p.category === c).length;
        return `<div class="col-6 col-lg-3"><div class="dash-card text-center">
          <div class="fs-4 fw-bold">${count}</div><div class="rbac-note">${c}</div>
        </div></div>`;
      }).join('')}
    </div>
  `;
}

/* ---------- Inventory ---------- */
function renderInventory(session) {
  const canEdit = isLevel1(session) || canManageDeptOnly(session) || session.department === 'Inventory & Warehouse';
  const products = KC.products || [];
  return `
    <h1 class="dash-section-title">Inventory</h1>
    <div class="row g-3 mb-3">
      ${statCard('bi-box-seam', '#2563EB', products.length, 'Total SKUs')}
      ${statCard('bi-exclamation-triangle', '#F59E0B', products.filter(p => p.stock > 0 && p.stock < 15).length, 'Low Stock Alerts')}
      ${statCard('bi-x-octagon', '#EF4444', products.filter(p => p.stock === 0).length, 'Out of Stock')}
    </div>
    <div class="dash-card">
      <div class="table-responsive">
        <table class="table dash-table align-middle">
          <thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Status</th>${canEdit ? '<th>Adjust</th>' : ''}</tr></thead>
          <tbody id="inventoryTableBody">
            ${products.map(p => inventoryRow(p, canEdit)).join('')}
          </tbody>
        </table>
      </div>
      ${!canEdit ? '<p class="rbac-note mt-2">Your role can view inventory but cannot adjust stock levels.</p>' : ''}
    </div>
  `;
}
function inventoryRow(p, canEdit) {
  return `<tr data-pid="${p.id}">
    <td class="text-muted small">${p.id.toUpperCase()}</td>
    <td>${p.name}</td>
    <td class="stock-cell">${p.stock}</td>
    <td>${stockBadge(p.stock)}</td>
    ${canEdit ? `<td>
      <button class="btn btn-sm btn-outline-success" onclick="adjustStock('${p.id}', 5)"><i class="bi bi-plus"></i> Stock In</button>
      <button class="btn btn-sm btn-outline-danger" onclick="adjustStock('${p.id}', -5)"><i class="bi bi-dash"></i> Stock Out</button>
    </td>` : ''}
  </tr>`;
}
function adjustStock(id, delta) {
  const p = KC.products.find(prod => prod.id === id);
  if (!p) return;
  p.stock = Math.max(0, p.stock + delta);
  const row = document.querySelector(`tr[data-pid="${id}"]`);
  if (row) {
    row.querySelector('.stock-cell').textContent = p.stock;
    row.children[3].innerHTML = stockBadge(p.stock);
  }
  showToast(`${p.name}: stock ${delta > 0 ? 'increased' : 'decreased'} to ${p.stock}`, delta > 0 ? 'success' : 'warning');
}

/* ---------- Orders ---------- */
function renderWorkerOrders() {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]').reverse();
  return `
    <h1 class="dash-section-title">Orders</h1>
    <div class="dash-card">
      <div class="table-responsive">
        <table class="table dash-table align-middle">
          <thead><tr><th>Order ID</th><th>Customer</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
          <tbody>
            ${orders.length ? orders.map(o => `<tr>
              <td>${o.id}</td><td>${o.shipping?.name || '—'}</td>
              <td>${new Date(o.date).toLocaleDateString()}</td>
              <td>$${o.total.toFixed(2)}</td><td class="text-capitalize">${o.paymentMethod}</td>
              <td>
                <select class="form-select form-select-sm dash-form-select" onchange="updateOrderStatus('${o.id}', this.value)" style="width:130px">
                  ${['Processing','Shipped','Out for Delivery','Delivered','Cancelled'].map(s => `<option ${s===o.status?'selected':''}>${s}</option>`).join('')}
                </select>
              </td>
            </tr>`).join('') : `<tr><td colspan="6" class="text-center rbac-note py-4">No orders yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function updateOrderStatus(id, status) {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const order = orders.find(o => o.id === id);
  if (order) { order.status = status; localStorage.setItem('kc_orders', JSON.stringify(orders)); showToast(`${id} marked ${status}`, 'success'); }
}

/* ---------- Customers ---------- */
function renderWorkerCustomers() {
  const users = getUsers();
  return `
    <h1 class="dash-section-title">Customers</h1>
    <div class="dash-card">
      <input type="search" class="form-control dash-form-control mb-3" style="max-width:280px" placeholder="Search customers..." oninput="filterCustomerTable(this.value)">
      <div class="table-responsive">
        <table class="table dash-table align-middle" id="customersTable">
          <thead><tr><th>Name</th><th>Email</th><th>Orders</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.length ? users.map(u => `<tr data-name="${(u.name || 'Unnamed Customer').toLowerCase()}">
              <td>${u.name || '<span class="rbac-note">Unnamed Customer</span>'}</td><td>${u.email}</td><td>${(u.orders||[]).length}</td>
              <td><span class="dash-badge ${u.status === 'Suspended' ? 'badge-suspended' : 'badge-active'}">${u.status || 'Active'}</span></td>
              <td>
                <button class="btn btn-sm btn-outline-light" onclick="toggleCustomerStatus('${u.id}')">${u.status === 'Suspended' ? 'Restore' : 'Suspend'}</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="5" class="text-center rbac-note py-4">No registered customers yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function filterCustomerTable(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#customersTable tbody tr').forEach(row => {
    row.style.display = (row.dataset.name || '').includes(q) ? '' : 'none';
  });
}
function toggleCustomerStatus(id) {
  const users = getUsers();
  const u = users.find(x => x.id === id);
  if (!u) return;
  u.status = u.status === 'Suspended' ? 'Active' : 'Suspended';
  saveUsers(users);
  showDashSection('customers');
  showToast(`Customer ${u.status === 'Suspended' ? 'suspended' : 'restored'}`, 'info');
}

/* ---------- Staff management (RBAC gated) ---------- */
function renderStaff(session) {
  const canManage = canManageStaff(session);
  const workers = getWorkers();
  return `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <h1 class="dash-section-title mb-0">Staff</h1>
      ${canManage ? `<button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#createWorkerModal"><i class="bi bi-person-plus"></i> Create Worker</button>` : ''}
    </div>
    ${!canManage ? `<p class="rbac-note mb-3">Your role (${session.role}) has view-only access to staff records. Worker account management is restricted to Level 1 administrators.</p>` : ''}
    <div class="dash-card">
      <div class="row g-2 mb-3">
        <div class="col-12 col-md-4"><input type="search" class="form-control dash-form-control" placeholder="Search staff..." oninput="filterStaffTable(this.value)"></div>
      </div>
      <div class="table-responsive">
        <table class="table dash-table align-middle" id="staffTable">
          <thead><tr><th>Employee</th><th>ID</th><th>Role</th><th>Level</th><th>Department</th><th>Status</th>${canManage ? '<th>Actions</th>' : ''}</tr></thead>
          <tbody>
            ${workers.map(w => `<tr data-name="${w.fullName.toLowerCase()}">
              <td class="d-flex align-items-center gap-2"><img src="${w.photo}" width="30" height="30" class="rounded-circle">${w.fullName}</td>
              <td>${w.employeeId}</td><td>${w.role}</td>
              <td><span class="dash-level-badge dash-level-${w.level}">L${w.level}</span></td>
              <td>${w.department}</td>
              <td><span class="dash-badge ${w.status === 'Suspended' ? 'badge-suspended' : 'badge-active'}">${w.status}</span></td>
              ${canManage ? `<td>
                <button class="btn btn-sm btn-outline-light me-1" onclick="resetWorkerPassword('${w.employeeId}')" title="Reset password"><i class="bi bi-key"></i></button>
                <button class="btn btn-sm btn-outline-warning me-1" onclick="toggleWorkerStatus('${w.employeeId}')" title="Suspend/Activate"><i class="bi bi-slash-circle"></i></button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteWorker('${w.employeeId}')" title="Delete"><i class="bi bi-trash"></i></button>
              </td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal fade dash-modal" id="createWorkerModal" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">Create Worker</h5><button class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
        <form id="createWorkerForm">
          <div class="modal-body">
            <div class="mb-2"><label class="form-label small">Full name</label><input class="form-control dash-form-control" name="fullName" required></div>
            <div class="mb-2"><label class="form-label small">Email</label><input type="email" class="form-control dash-form-control" name="email" required></div>
            <div class="mb-2"><label class="form-label small">Role</label><input class="form-control dash-form-control" name="role" placeholder="e.g. Cashier" required></div>
            <div class="mb-2"><label class="form-label small">Department</label><input class="form-control dash-form-control" name="department" placeholder="e.g. Sales" required></div>
            <div class="mb-2"><label class="form-label small">Access Level</label>
              <select class="form-select dash-form-select" name="level">
                <option value="2">Level 2 — Department Manager</option>
                <option value="3">Level 3 — Supervisor</option>
                <option value="4" selected>Level 4 — Employee</option>
                <option value="5">Level 5 — Read Only</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-primary">Create &amp; Generate Credentials</button>
          </div>
        </form>
      </div></div>
    </div>
  `;
}
function filterStaffTable(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#staffTable tbody tr').forEach(row => {
    row.style.display = (row.dataset.name || '').includes(q) ? '' : 'none';
  });
}
function toggleWorkerStatus(empId) {
  const workers = getWorkers();
  const w = workers.find(x => x.employeeId === empId);
  if (!w) return;
  w.status = w.status === 'Suspended' ? 'Active' : 'Suspended';
  saveWorkers(workers);
  showDashSection('staff');
  showToast(`${w.fullName} ${w.status === 'Suspended' ? 'suspended' : 'reactivated'}`, 'info');
}
function deleteWorker(empId) {
  if (!confirm('Delete this worker account? This cannot be undone.')) return;
  saveWorkers(getWorkers().filter(w => w.employeeId !== empId));
  showDashSection('staff');
  showToast('Worker account deleted', 'danger');
}
function resetWorkerPassword(empId) {
  const workers = getWorkers();
  const w = workers.find(x => x.employeeId === empId);
  if (!w) return;
  const temp = Math.random().toString(36).slice(-8);
  w.password = temp;
  saveWorkers(workers);
  alert(`Temporary password for ${w.fullName}: ${temp}`);
}
function generateEmployeeId(workers) {
  const nums = workers.map(w => parseInt(w.employeeId.replace('KC-', ''), 10)).filter(n => !isNaN(n));
  const next = (Math.max(0, ...nums) + 1).toString().padStart(4, '0');
  return `KC-${next}`;
}

/* ---------- Departments ---------- */
function renderDepartments() {
  const workers = getWorkers();
  const depts = {};
  workers.forEach(w => { depts[w.department] = (depts[w.department] || 0) + 1; });
  return `
    <h1 class="dash-section-title">Departments</h1>
    <div class="row g-3">
      ${Object.entries(depts).map(([name, count]) => `
        <div class="col-6 col-lg-3"><div class="dash-card text-center">
          <div class="fs-4 fw-bold">${count}</div><div class="rbac-note">${name}</div>
        </div></div>`).join('')}
    </div>
  `;
}

/* ---------- Reports ---------- */
function renderReports() {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const products = KC.products || [];
  return `
    <h1 class="dash-section-title">Reports</h1>
    <div class="dash-card mb-3">
      <div class="row g-2">
        ${['Daily','Weekly','Monthly','Annual','Inventory','Revenue','Employee','Customer','Sales','Product'].map(r =>
          `<div class="col-6 col-md-3"><button class="btn btn-outline-light btn-sm w-100" onclick="generateReport('${r}')">${r} Report</button></div>`
        ).join('')}
      </div>
    </div>
    <div class="dash-card" id="reportOutput">
      <p class="rbac-note">Select a report above to generate a summary from current demo data.</p>
    </div>
  `;
}
function generateReport(type) {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const products = KC.products || [];
  const workers = getWorkers();
  const box = document.getElementById('reportOutput');
  box.innerHTML = `
    <h2 class="fs-6 fw-bold mb-3">${type} Report — ${new Date().toLocaleDateString()}</h2>
    <div class="row g-3">
      ${statCard('bi-cash-stack', '#22C55E', '$' + revenue.toFixed(2), 'Revenue')}
      ${statCard('bi-bag-check', '#2563EB', orders.length, 'Orders')}
      ${statCard('bi-box-seam', '#F59E0B', products.length, 'Products Tracked')}
      ${statCard('bi-people', '#A855F7', workers.length, 'Staff')}
    </div>
  `;
}

/* ---------- Sales / Suppliers / Deliveries / Finance / Marketing / Messages (lighter sections) ---------- */
function renderSales() {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const sumSince = (since) => {
    const filtered = orders.filter(o => new Date(o.date) >= since);
    return { total: filtered.reduce((s, o) => s + (o.total || 0), 0), count: filtered.length };
  };
  const today = sumSince(startOfDay), week = sumSince(startOfWeek), month = sumSince(startOfMonth), year = sumSince(startOfYear);

  return `
    <h1 class="dash-section-title">Sales Dashboard</h1>
    <div class="row g-3 mb-4">
      ${statCard('bi-graph-up', '#22C55E', '$' + today.total.toFixed(2), `Today (${today.count} orders)`)}
      ${statCard('bi-graph-up', '#2563EB', '$' + week.total.toFixed(2), `This Week (${week.count} orders)`)}
      ${statCard('bi-graph-up', '#F59E0B', '$' + month.total.toFixed(2), `This Month (${month.count} orders)`)}
      ${statCard('bi-graph-up', '#8B5CF6', '$' + year.total.toFixed(2), `This Year (${year.count} orders)`)}
    </div>

    <div class="dash-card mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 class="fs-6 fw-bold mb-0">Revenue Trend</h2>
        <form id="salesRangeForm" class="d-flex align-items-center gap-2 flex-wrap">
          <label class="small text-nowrap mb-0">From</label>
          <input type="date" class="form-control form-control-sm dash-form-control" name="fromDate" style="width:150px">
          <label class="small text-nowrap mb-0">To</label>
          <input type="date" class="form-control form-control-sm dash-form-control" name="toDate" style="width:150px">
          <button type="submit" class="btn btn-primary btn-sm">Apply</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="resetSalesRange()">Reset</button>
        </form>
      </div>
      <canvas id="salesRangeChart" class="dash-chart"></canvas>
    </div>

    <div class="row g-3">
      ${statCard('bi-receipt', '#2563EB', orders.length, 'All-Time Transactions')}
      ${statCard('bi-arrow-up-circle', '#F59E0B', orders.length ? '$' + (orders.reduce((s,o)=>s+o.total,0)/orders.length).toFixed(2) : '$0', 'Avg. Order Value')}
    </div>
  `;
}
function resetSalesRange() {
  const form = document.getElementById('salesRangeForm');
  if (form) form.reset();
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  drawSalesRangeChart(orders, null, null);
}
function drawSalesRangeChart(orders, fromDate, toDate) {
  const canvas = document.getElementById('salesRangeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 260;

  let start, end;
  if (fromDate && toDate) {
    start = new Date(fromDate); start.setHours(0,0,0,0);
    end = new Date(toDate); end.setHours(23,59,59,999);
  } else {
    end = new Date();
    start = new Date(); start.setDate(start.getDate() - 13); start.setHours(0,0,0,0);
  }

  const dayMs = 86400000;
  const totalDays = Math.max(1, Math.round((end - start) / dayMs) + 1);
  const days = [...Array(totalDays)].map((_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    return d;
  });
  const totals = days.map(d => {
    const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(d); dayEnd.setHours(23,59,59,999);
    return orders.filter(o => { const od = new Date(o.date); return od >= dayStart && od <= dayEnd; })
      .reduce((sum, o) => sum + (o.total || 0), 0);
  });
  const max = Math.max(...totals, 10);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 20 + i * ((canvas.height - 40) / 4);
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(canvas.width - 10, y); ctx.stroke();
  }

  const stepX = (canvas.width - 50) / Math.max(1, totals.length - 1);
  ctx.strokeStyle = '#F59E0B'; ctx.lineWidth = 2.5; ctx.beginPath();
  totals.forEach((v, i) => {
    const x = 35 + i * stepX;
    const y = (canvas.height - 20) - (v / max) * (canvas.height - 40);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#F59E0B';
  totals.forEach((v, i) => {
    const x = 35 + i * stepX;
    const y = (canvas.height - 20) - (v / max) * (canvas.height - 40);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  });

  ctx.fillStyle = '#94A3B8'; ctx.font = '9px Inter';
  const labelEvery = Math.ceil(totals.length / 10) || 1;
  days.forEach((d, i) => {
    if (i % labelEvery !== 0 && i !== days.length - 1) return;
    const x = 35 + i * stepX;
    ctx.fillText(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), x - 14, canvas.height - 4);
  });
}
function renderSuppliers() {
  const suppliers = [
    { name: 'Global Tech Distributors', category: 'Technology', contact: 'sales@globaltechdist.com', status: 'Active' },
    { name: 'CircuitWorks Wholesale', category: 'Technology', contact: 'orders@circuitworks.com', status: 'Active' },
    { name: 'NextGen Electronics Supply', category: 'Technology', contact: 'partners@nextgenelec.com', status: 'Active' },
    { name: 'PureWear Textiles', category: 'Fashion', contact: 'wholesale@purewear.com', status: 'Active' },
    { name: 'Metro Apparel Group', category: 'Fashion', contact: 'accounts@metroapparel.com', status: 'Active' },
    { name: 'StrideCo Footwear Ltd.', category: 'Fashion', contact: 'b2b@strideco.com', status: 'Active' },
    { name: 'HomeCraft Living', category: 'Home Goods', contact: 'sales@homecraftliving.com', status: 'Active' },
    { name: 'Artisan Home Supply Co.', category: 'Home Goods', contact: 'orders@artisanhome.com', status: 'Active' },
    { name: 'GlowLab Cosmetics Co.', category: 'Beauty', contact: 'trade@glowlab.com', status: 'Active' },
    { name: 'Radiance Beauty Wholesale', category: 'Beauty', contact: 'wholesale@radiancebeauty.com', status: 'Active' },
    { name: 'IronCore Fitness Supply', category: 'Sports', contact: 'sales@ironcorefitness.com', status: 'Active' },
    { name: 'ActiveEdge Sportswear', category: 'Sports', contact: 'partners@activeedge.com', status: 'Pending Review' },
  ];
  return `<h1 class="dash-section-title">Suppliers</h1>
    <div class="dash-card"><table class="table dash-table"><thead><tr><th>Supplier</th><th>Category</th><th>Contact</th><th>Status</th></tr></thead>
    <tbody>${suppliers.map(s => `<tr><td>${s.name}</td><td>${s.category}</td><td class="text-muted small">${s.contact}</td><td><span class="dash-badge ${s.status==='Active'?'badge-active':'badge-low'}">${s.status}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function renderDeliveries() {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]').slice().reverse();
  const drivers = ['Unassigned', 'Sam Okon', 'Tunde Bakare', 'Chinedu Eze', 'Blessing Okafor', 'Ekene Obi'];
  return `<h1 class="dash-section-title">Deliveries</h1>
    <div class="dash-card">
      <div class="table-responsive">
        <table class="table dash-table align-middle">
          <thead><tr><th>Order</th><th>Customer</th><th>Address</th><th>Driver</th><th>Est. Delivery</th><th>Status</th></tr></thead>
          <tbody>
            ${orders.length ? orders.map(o => {
              const addr = o.shipping ? `${o.shipping.address || ''}, ${o.shipping.city || ''}`.replace(/^,\s*/, '') : '—';
              const estDate = new Date(new Date(o.date).getTime() + 4 * 86400000).toLocaleDateString();
              return `<tr>
                <td>${o.id}</td>
                <td>${o.shipping?.name || '—'}</td>
                <td class="small">${addr || '—'}</td>
                <td>
                  <select class="form-select form-select-sm dash-form-select" onchange="updateDeliveryDriver('${o.id}', this.value)" style="width:150px">
                    ${drivers.map(d => `<option ${d===(o.driver||'Unassigned')?'selected':''}>${d}</option>`).join('')}
                  </select>
                </td>
                <td class="small">${o.estDelivery || estDate}</td>
                <td>
                  <select class="form-select form-select-sm dash-form-select" onchange="updateOrderStatus('${o.id}', this.value)" style="width:150px">
                    ${['Processing','Shipped','Out for Delivery','Delivered','Cancelled'].map(s => `<option ${s===o.status?'selected':''}>${s}</option>`).join('')}
                  </select>
                </td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="text-center rbac-note py-3">No deliveries yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}
function updateDeliveryDriver(id, driver) {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const order = orders.find(o => o.id === id);
  if (order) { order.driver = driver; localStorage.setItem('kc_orders', JSON.stringify(orders)); showToastSafe(`${id} assigned to ${driver}`, 'success'); }
}
function renderFinance() {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const expenses = revenue * 0.42;
  return `<h1 class="dash-section-title">Finance</h1>
    <div class="row g-3">
      ${statCard('bi-cash-stack', '#22C55E', '$' + revenue.toFixed(2), 'Revenue')}
      ${statCard('bi-wallet2', '#EF4444', '$' + expenses.toFixed(2), 'Expenses (est.)')}
      ${statCard('bi-piggy-bank', '#2563EB', '$' + (revenue - expenses).toFixed(2), 'Net Profit (est.)')}
    </div>`;
}
function renderMarketing() {
  return `<h1 class="dash-section-title">Marketing</h1>
    <div class="dash-card">
      <p class="rbac-note">Active campaigns (demo)</p>
      <ul class="mb-0">
        <li>Tech Extravaganza — up to 40% off</li>
        <li>Flash Deals — rotating hourly discounts</li>
        <li>Newsletter signup — 10% off first order (KENE10)</li>
      </ul>
    </div>`;
}
function renderMessages(session) {
  const users = getUsers();
  const workers = getWorkers();
  const departments = [...new Set(workers.map(w => w.department))].sort();
  const isL1 = isLevel1(session);
  const isL2 = session.level === 2;

  return `
    <h1 class="dash-section-title">Messages</h1>
    <div class="row g-3">
      <div class="col-12 col-lg-7">
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-3">Send a Message</h2>
          <form id="sendMessageForm">
            <div class="mb-2">
              <label class="form-label small">Audience</label>
              <select class="form-select dash-form-select" name="audienceType" id="audienceTypeSelect">
                ${isL1 ? `<option value="everyone">Everyone, including customers</option>` : ''}
                <option value="customers">Only customers (all of them)</option>
                <option value="customer">One specific customer</option>
                ${(isL1 || isL2) ? `<option value="department">A specific department</option>` : ''}
                ${isL1 ? `<option value="worker">One specific worker</option>` : ''}
                ${isL1 ? `<option value="team">Everyone except customers (all workers)</option>` : ''}
              </select>
              ${!isL1 ? `<p class="rbac-note mt-1 mb-0">Your access level (${session.role}) limits which audiences you can reach. Level 1 admins can message anyone.</p>` : ''}
            </div>

            <div class="mb-2 d-none" id="audienceCustomerWrap">
              <label class="form-label small">Customer</label>
              <select class="form-select dash-form-select" id="audienceCustomerSelect">
                ${users.map(u => `<option value="${u.email}">${u.name} (${u.email})</option>`).join('')}
              </select>
            </div>
            <div class="mb-2 d-none" id="audienceDeptWrap">
              <label class="form-label small">Department</label>
              <select class="form-select dash-form-select" id="audienceDeptSelect">
                ${departments.map(d => `<option value="${d}" ${d===session.department?'selected':''}>${d}</option>`).join('')}
              </select>
              ${isL2 && !isL1 ? `<p class="rbac-note mt-1 mb-0">As a department manager, you can only message your own department.</p>` : ''}
            </div>
            <div class="mb-2 d-none" id="audienceWorkerWrap">
              <label class="form-label small">Worker</label>
              <select class="form-select dash-form-select" id="audienceWorkerSelect">
                ${workers.map(w => `<option value="${w.employeeId}">${w.fullName} — ${w.employeeId} (${w.role})</option>`).join('')}
              </select>
            </div>

            <div class="mb-2">
              <label class="form-label small">Subject</label>
              <input class="form-control dash-form-control" name="subject" placeholder="e.g. Order Update">
            </div>
            <div class="mb-2">
              <label class="form-label small">Message</label>
              <textarea class="form-control dash-form-control" name="text" rows="4" required placeholder="Type your message..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary"><i class="bi bi-send"></i> Send</button>
          </form>
        </div>
      </div>
      <div class="col-12 col-lg-5">
        <div class="dash-card mb-3">
          <h2 class="fs-6 fw-bold mb-2">Sent Messages</h2>
          <div id="sentMessagesList"></div>
        </div>
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-2"><i class="bi bi-megaphone"></i> Messages For You</h2>
          <p class="rbac-note mb-2">Team-wide, your department, and anything sent directly to you.</p>
          <div id="teamMessagesList"></div>
        </div>
      </div>
    </div>`;
}
function toggleAudienceFields() {
  const type = document.getElementById('audienceTypeSelect')?.value;
  document.getElementById('audienceCustomerWrap')?.classList.toggle('d-none', type !== 'customer');
  document.getElementById('audienceDeptWrap')?.classList.toggle('d-none', type !== 'department');
  document.getElementById('audienceWorkerWrap')?.classList.toggle('d-none', type !== 'worker');
}
function renderTeamMessages(session) {
  const box = document.getElementById('teamMessagesList');
  if (!box) return;
  const msgs = JSON.parse(localStorage.getItem('kc_team_messages') || '[]').slice().reverse();
  const mine = msgs.filter(m =>
    !m.department && !m.targetEmployeeId ? true : // broadcast to all workers
    (m.department && m.department === session.department) ||
    (m.targetEmployeeId && m.targetEmployeeId === session.employeeId)
  );
  box.innerHTML = mine.length ? mine.map(m => `
    <div class="d-flex align-items-start gap-2 py-2 border-bottom" style="border-color:var(--dash-border)!important">
      <i class="bi bi-megaphone text-warning"></i>
      <div>
        <div class="small">${m.subject ? `<strong>${escapeHTML(m.subject)}:</strong> ` : ''}${escapeHTML(m.text)}</div>
        <div class="rbac-note">${m.fromName} · ${m.department ? `To: ${m.department}` : (m.targetEmployeeId ? 'Direct message' : 'All staff')} · ${new Date(m.date).toLocaleString()}</div>
      </div>
    </div>`).join('') : `<p class="rbac-note">No messages for you yet.</p>`;
}
function renderSentMessages() {
  const box = document.getElementById('sentMessagesList');
  if (!box) return;
  const custNotifs = JSON.parse(localStorage.getItem('kc_customer_notifications') || '[]')
    .map(n => ({ text: n.text, date: n.date, label: n.toEmail === 'all' ? 'All customers' : n.toEmail }));
  const teamMsgs = JSON.parse(localStorage.getItem('kc_team_messages') || '[]')
    .map(m => ({ text: m.text, date: m.date, label: m.department ? `Dept: ${m.department}` : (m.targetEmployeeId ? `Worker: ${m.targetEmployeeId}` : 'All workers') }));
  const all = [...custNotifs, ...teamMsgs].sort((a, b) => new Date(b.date) - new Date(a.date));

  box.innerHTML = all.length ? all.map(n => `
    <div class="d-flex justify-content-between border-bottom py-2">
      <span class="small">${escapeHTML(n.text)}</span>
      <span class="rbac-note">${n.label} · ${new Date(n.date).toLocaleDateString()}</span>
    </div>`).join('') : `<p class="rbac-note">No messages sent yet.</p>`;
}

/* ---------- Notifications ---------- */
function renderNotifications(session) {
  const all = getAllWorkerNotifications();
  markNotificationsRead(session);
  updateWorkerNotifBadge(session);
  return `
    <h1 class="dash-section-title">Notification Center</h1>
    <div class="dash-card">
      ${all.length ? all.map(n => `
        <div class="d-flex align-items-start gap-2 py-2 border-bottom" style="border-color:var(--dash-border)!important">
          <i class="bi ${n.icon}" style="color:${n.color}"></i>
          <div><div class="small">${n.text}</div><div class="rbac-note">${new Date(n.time).toLocaleString()}</div></div>
        </div>`).join('') : '<p class="rbac-note">No notifications yet.</p>'}
    </div>
  `;
}
function getAllWorkerNotifications() {
  const stored = JSON.parse(localStorage.getItem('kc_notifications') || '[]');
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const generated = orders.slice(-5).reverse().map(o => ({ id: `order-${o.id}`, text: `New order ${o.id} received — $${o.total.toFixed(2)}`, time: o.date, icon: 'bi-bag-check', color: '#2563EB' }));
  const products = (KC.products || []).filter(p => p.stock < 15).slice(0, 3).map(p => ({ id: `stock-${p.id}`, text: `Low stock: ${p.name} (${p.stock} left)`, time: new Date().toISOString(), icon: 'bi-exclamation-triangle', color: '#F59E0B' }));
  return [...generated, ...products, ...stored.map(n => ({ ...n, id: n.id || `stored-${n.text}` }))];
}
function markNotificationsRead(session) {
  if (!session) return;
  const all = getAllWorkerNotifications();
  const key = `kc_worker_notif_read_${session.employeeId}`;
  const readIds = JSON.parse(localStorage.getItem(key) || '[]');
  all.forEach(n => { if (!readIds.includes(n.id)) readIds.push(n.id); });
  localStorage.setItem(key, JSON.stringify(readIds));
}
function updateWorkerNotifBadge(session) {
  const badge = document.getElementById('workerNotifBadge');
  if (!badge || !session) return;
  const all = getAllWorkerNotifications();
  const key = `kc_worker_notif_read_${session.employeeId}`;
  const readIds = JSON.parse(localStorage.getItem(key) || '[]');
  const unread = all.filter(n => !readIds.includes(n.id)).length;
  badge.textContent = unread;
  badge.classList.toggle('d-none', unread === 0);
}

/* ---------- Settings ---------- */
function renderSettings(session) {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const canManage = isLevel1(session);
  const config = getStoreConfig();
  const workers = getWorkers();

  const rolesPanel = `
    <div class="dash-card">
      <h2 class="fs-6 fw-bold mb-3">Roles &amp; Permissions</h2>
      <div class="dash-role-block" style="border-left-color:#F87171">
        <div class="fw-bold" style="color:#F87171">Level 1 — System Administrator</div>
        <ul class="rbac-note mb-0 mt-1">
          <li>Create, edit, and delete worker accounts</li>
          <li>Suspend or restore workers</li>
          <li>Reset passwords</li>
          <li>Assign roles and permissions</li>
          <li>Change departments</li>
          <li>Full access to every dashboard section</li>
        </ul>
      </div>
      <div class="dash-role-block" style="border-left-color:#FBBF24">
        <div class="fw-bold" style="color:#FBBF24">Level 2 — Department Manager</div>
        <ul class="rbac-note mb-0 mt-1">
          <li>Manage their own department</li>
          <li>Approve requests</li>
          <li>Assign tasks to staff</li>
          <li>View reports</li>
          <li>Evaluate employees</li>
          <li>View (not edit) the Staff directory</li>
        </ul>
      </div>
      <div class="dash-role-block" style="border-left-color:#60A5FA">
        <div class="fw-bold" style="color:#60A5FA">Level 3 — Supervisor</div>
        <ul class="rbac-note mb-0 mt-1">
          <li>View reports</li>
          <li>Monitor attendance</li>
          <li>Assign daily tasks</li>
          <li>Monitor performance</li>
        </ul>
      </div>
      <div class="dash-role-block" style="border-left-color:#4ADE80">
        <div class="fw-bold" style="color:#4ADE80">Level 4 — Employee</div>
        <ul class="rbac-note mb-0 mt-1"><li>Perform tasks specific to their own role only</li></ul>
      </div>
      <div class="dash-role-block" style="border-left-color:#94A3B8">
        <div class="fw-bold" style="color:#94A3B8">Level 5 — Read Only</div>
        <ul class="rbac-note mb-0 mt-1"><li>View dashboard and reports only, no edit access</li></ul>
      </div>
    </div>`;

  return `
    <h1 class="dash-section-title">Settings</h1>
    <div class="dash-card mb-3" style="max-width:420px">
      <h2 class="fs-6 fw-bold mb-2">Appearance</h2>
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="darkModeSwitch" ${theme === 'dark' ? 'checked' : ''} onchange="toggleTheme()">
        <label class="form-check-label small" for="darkModeSwitch">Dark mode (site-wide)</label>
      </div>
    </div>

    <div class="dash-card mb-3" style="max-width:420px">
      <h2 class="fs-6 fw-bold mb-2">Troubleshooting</h2>
      <p class="rbac-note mb-2">Seeing broken or duplicate staff data? Reset it back to the default demo roster (this only affects data stored in this browser).</p>
      <button type="button" class="btn btn-outline-danger btn-sm" onclick="resetDemoData()"><i class="bi bi-arrow-counterclockwise"></i> Reset Demo Data</button>
    </div>

    ${!canManage ? `
      <div class="row g-3">
        <div class="col-12 col-lg-6">
          <div class="dash-card">
            <p class="rbac-note mb-0"><i class="bi bi-lock"></i> Store configuration and worker access management are restricted to Level 1 administrators. Your role (${session.role}) does not have access to this section.</p>
          </div>
        </div>
        <div class="col-12 col-lg-6">${rolesPanel}</div>
      </div>
    ` : `
      <div class="row g-3">
        <div class="col-12 col-lg-6">
          <div class="dash-card mb-3">
            <h2 class="fs-6 fw-bold mb-2">Store Configuration</h2>
            <form id="storeConfigForm">
              <div class="row g-2">
                <div class="col-12"><label class="form-label small">Store name</label><input class="form-control dash-form-control" name="storeName" value="${config.storeName}"></div>
                <div class="col-12"><label class="form-label small">Tagline</label><input class="form-control dash-form-control" name="tagline" value="${config.tagline || 'Everything You Need In One Place.'}"></div>
                <div class="col-6"><label class="form-label small">Currency</label>
                  <select class="form-select dash-form-select" name="currency">
                    ${['USD','EUR','GBP','NGN'].map(c => `<option ${config.currency===c?'selected':''}>${c}</option>`).join('')}
                  </select>
                </div>
                <div class="col-6"><label class="form-label small">VAT rate (%)</label><input type="number" step="0.1" class="form-control dash-form-control" name="vatRate" value="${config.vatRate}"></div>
                <div class="col-6"><label class="form-label small">Delivery fee ($)</label><input type="number" step="0.01" class="form-control dash-form-control" name="deliveryFee" value="${config.deliveryFee}"></div>
                <div class="col-6"><label class="form-label small">Free delivery threshold ($)</label><input type="number" step="1" class="form-control dash-form-control" name="freeDeliveryThreshold" value="${config.freeDeliveryThreshold}"></div>
                <div class="col-12"><label class="form-label small">Support email</label><input type="email" class="form-control dash-form-control" name="supportEmail" value="${config.supportEmail || 'support@kenecart.com'}"></div>
              </div>
              <button type="submit" class="btn btn-primary btn-sm mt-2"><i class="bi bi-check-lg"></i> Save Settings</button>
              <span id="storeConfigSaveStatus" class="small text-success ms-2"></span>
              <p class="rbac-note mt-2 mb-0">Demo only — saved to this browser, not a live server.</p>
            </form>
          </div>

          <div class="dash-card">
            <h2 class="fs-6 fw-bold mb-2">Worker Access &amp; Permissions</h2>
            <p class="rbac-note mb-2">Change a worker's role or RBAC level. New workers are created from Staff.</p>
            <form id="workerAccessForm" class="row g-2 align-items-end">
              <div class="col-12 col-md-5">
                <label class="form-label small">Worker</label>
                <select class="form-select dash-form-select" name="employeeId" id="accessWorkerSelect">
                  ${workers.map(w => `<option value="${w.employeeId}">${w.fullName} — ${w.employeeId} (Level ${w.level})</option>`).join('')}
                </select>
              </div>
              <div class="col-8 col-md-4">
                <label class="form-label small">New role title</label>
                <input class="form-control dash-form-control" name="newRole" id="accessNewRole" placeholder="e.g. Sales Manager">
              </div>
              <div class="col-4 col-md-3">
                <label class="form-label small">Level</label>
                <select class="form-select dash-form-select" name="newLevel" id="accessNewLevel">
                  <option value="1">1 — Admin</option>
                  <option value="2">2 — Manager</option>
                  <option value="3">3 — Supervisor</option>
                  <option value="4">4 — Employee</option>
                  <option value="5">5 — Read Only</option>
                </select>
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-primary btn-sm mt-2"><i class="bi bi-shield-check"></i> Update Access</button>
                <span id="workerAccessStatus" class="small text-success ms-2"></span>
              </div>
            </form>
          </div>
        </div>
        <div class="col-12 col-lg-6">${rolesPanel}</div>
      </div>
    `}
  `;
}

const STORE_CONFIG_KEY = 'kc_store_config';
function getStoreConfig() {
  return JSON.parse(localStorage.getItem(STORE_CONFIG_KEY) || 'null') || {
    storeName: 'KeneCart', tagline: 'Everything You Need In One Place.', currency: 'USD',
    vatRate: 7.5, deliveryFee: 4.99, freeDeliveryThreshold: 50, supportEmail: 'support@kenecart.com'
  };
}
function saveStoreConfig(config) {
  localStorage.setItem(STORE_CONFIG_KEY, JSON.stringify(config));
}

/* ---------- Worker profile ---------- */
function renderWorkerProfile(session) {
  const workers = getWorkers();
  const w = workers.find(x => x.employeeId === session.employeeId) || session;
  return `
    <h1 class="dash-section-title">My Profile</h1>
    <div class="row g-3">
      <div class="col-12 col-md-4">
        <div class="dash-card text-center">
          <img id="wProfilePhotoPreview" src="${w.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(w.fullName))}" class="rounded-circle mb-2" width="90" height="90" style="object-fit:cover">
          <h2 class="fs-6 fw-bold mb-0">${w.fullName}</h2>
          <p class="rbac-note">${w.role} · ${w.department}</p>
          <table class="table dash-table mb-0 mt-3 text-start">
            <tbody>
              <tr><td class="text-muted">Employee ID</td><td>${w.employeeId}</td></tr>
              <tr><td class="text-muted">Access Level</td><td>Level ${w.level}</td></tr>
              <tr><td class="text-muted">Date Employed</td><td>${w.dateEmployed || '—'}</td></tr>
            </tbody>
          </table>
          <p class="rbac-note mt-2">Role, department, and access level are managed by a Level 1 administrator via Staff.</p>
        </div>
      </div>
      <div class="col-12 col-md-8">
        <div class="dash-card">
          <h2 class="fs-6 fw-bold mb-3">Edit My Details</h2>
          <form id="workerProfileForm">
            <div class="row g-3">
              <div class="col-12"><label class="form-label small">Profile photo URL</label><input type="url" class="form-control dash-form-control" name="photo" value="${w.photo || ''}" placeholder="https://..."></div>
              <div class="col-md-6"><label class="form-label small">Full name</label><input class="form-control dash-form-control" name="fullName" value="${w.fullName || ''}" required></div>
              <div class="col-md-6"><label class="form-label small">Email</label><input type="email" class="form-control dash-form-control" name="email" value="${w.email || ''}" required></div>
              <div class="col-md-6"><label class="form-label small">Phone</label><input class="form-control dash-form-control" name="phone" value="${w.phone || ''}" placeholder="Optional"></div>
              <div class="col-md-6"><label class="form-label small">Age</label><input type="number" class="form-control dash-form-control" name="age" value="${w.age || ''}" placeholder="Optional"></div>
              <div class="col-md-6"><label class="form-label small">Branch</label><input class="form-control dash-form-control" name="branch" value="${w.branch || ''}"></div>
              <div class="col-md-6">
                <label class="form-label small">Shift</label>
                <select class="form-select dash-form-select" name="shift">
                  ${['Day','Morning','Evening'].map(s => `<option ${w.shift===s?'selected':''}>${s}</option>`).join('')}
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-sm mt-3"><i class="bi bi-check-lg"></i> Save Changes</button>
            <span id="workerProfileSaveStatus" class="small text-success ms-2"></span>
          </form>
        </div>
      </div>
    </div>
  `;
}

/* ---------- Section-specific event wiring ---------- */
function attachSectionHandlers(name, session) {
  if (name === 'staff') {
    const form = document.getElementById('createWorkerForm');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const workers = getWorkers();
      const newWorker = {
        employeeId: generateEmployeeId(workers),
        password: Math.random().toString(36).slice(-8),
        fullName: form.fullName.value.trim(),
        email: form.email.value.trim(),
        role: form.role.value.trim(),
        department: form.department.value.trim(),
        level: parseInt(form.level.value, 10),
        status: 'Active',
        branch: session.branch || 'HQ',
        shift: 'Day',
        dateEmployed: new Date().toISOString().slice(0, 10),
        photo: 'https://ui-avatars.com/api/?name=' + encodeURIComponent(form.fullName.value.trim()) + '&background=2563EB&color=fff'
      };
      workers.push(newWorker);
      saveWorkers(workers);
      bootstrap.Modal.getInstance(document.getElementById('createWorkerModal'))?.hide();
      alert(`Worker created!\nEmployee ID: ${newWorker.employeeId}\nTemporary Password: ${newWorker.password}`);
      showDashSection('staff');
    });
  }
  if (name === 'messages') {
    renderSentMessages();
    renderTeamMessages(session);

    const audienceSelect = document.getElementById('audienceTypeSelect');
    if (audienceSelect) { audienceSelect.addEventListener('change', toggleAudienceFields); toggleAudienceFields(); }

    const form = document.getElementById('sendMessageForm');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const audienceType = document.getElementById('audienceTypeSelect').value;
      const subject = form.subject.value.trim();
      const text = form.text.value.trim();
      const fullText = subject ? `${subject}: ${text}` : text;
      const isL1 = isLevel1(session);
      const isL2 = session.level === 2;

      const pushCustomerNotif = (toEmail) => {
        const notifs = JSON.parse(localStorage.getItem('kc_customer_notifications') || '[]');
        notifs.push({ id: 'N-' + Date.now().toString(36).toUpperCase(), toEmail, text: fullText, date: new Date().toISOString(), icon: 'bi-megaphone' });
        localStorage.setItem('kc_customer_notifications', JSON.stringify(notifs));
      };
      const pushTeamMsg = (extra = {}) => {
        const msgs = JSON.parse(localStorage.getItem('kc_team_messages') || '[]');
        msgs.push({ id: 'TM-' + Date.now().toString(36).toUpperCase(), text: fullText, subject, fromName: session.fullName, fromRole: session.role, date: new Date().toISOString(), ...extra });
        localStorage.setItem('kc_team_messages', JSON.stringify(msgs));
      };

      switch (audienceType) {
        case 'everyone':
          if (!isL1) { showToastSafe('Only Level 1 admins can message everyone, including customers', 'warning'); return; }
          pushCustomerNotif('all');
          pushTeamMsg();
          showToastSafe('Message sent to everyone', 'success');
          break;
        case 'customers':
          pushCustomerNotif('all');
          showToastSafe('Message sent to all customers', 'success');
          break;
        case 'customer': {
          const email = document.getElementById('audienceCustomerSelect')?.value;
          if (!email) { showToastSafe('Choose a customer first', 'warning'); return; }
          pushCustomerNotif(email);
          showToastSafe('Message sent to that customer', 'success');
          break;
        }
        case 'department': {
          if (!isL1 && !isL2) { showToastSafe('You do not have permission to message a department', 'warning'); return; }
          let dept = document.getElementById('audienceDeptSelect')?.value;
          if (isL2 && !isL1) dept = session.department; // department managers can only target their own department
          if (!dept) { showToastSafe('Choose a department first', 'warning'); return; }
          pushTeamMsg({ department: dept });
          showToastSafe(`Message sent to ${dept}`, 'success');
          break;
        }
        case 'worker': {
          if (!isL1) { showToastSafe('Only Level 1 admins can message a specific worker', 'warning'); return; }
          const empId = document.getElementById('audienceWorkerSelect')?.value;
          if (!empId) { showToastSafe('Choose a worker first', 'warning'); return; }
          pushTeamMsg({ targetEmployeeId: empId });
          showToastSafe('Direct message sent', 'success');
          break;
        }
        case 'team':
          if (!isL1) { showToastSafe('Only Level 1 admins can message all workers', 'warning'); return; }
          pushTeamMsg();
          showToastSafe('Message sent to all workers', 'success');
          break;
        default:
          showToastSafe('Choose an audience first', 'warning');
          return;
      }

      form.reset();
      toggleAudienceFields();
      renderSentMessages();
      renderTeamMessages(session);
    });
  }
  if (name === 'profile') {
    const form = document.getElementById('workerProfileForm');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const workers = getWorkers();
      const w = workers.find(x => x.employeeId === session.employeeId);
      if (!w) return;
      w.fullName = form.fullName.value.trim();
      w.email = form.email.value.trim();
      w.phone = form.phone.value.trim();
      w.age = form.age.value.trim();
      w.branch = form.branch.value.trim();
      w.shift = form.shift.value;
      if (form.photo.value.trim()) w.photo = form.photo.value.trim();
      saveWorkers(workers);
      setWorkerSession(w);
      document.getElementById('wSidebarName').textContent = w.fullName;
      const photoPreview = document.getElementById('wProfilePhotoPreview');
      if (photoPreview) photoPreview.src = w.photo;
      document.getElementById('workerProfileSaveStatus').textContent = 'Saved!';
      showToastSafe('Profile updated', 'success');
      setTimeout(() => { const s = document.getElementById('workerProfileSaveStatus'); if (s) s.textContent = ''; }, 2000);
    });
  }
  if (name === 'sales') {
    const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
    drawSalesRangeChart(orders, null, null);
    const rangeForm = document.getElementById('salesRangeForm');
    if (rangeForm) rangeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!rangeForm.fromDate.value || !rangeForm.toDate.value) { showToastSafe('Choose both a start and end date', 'warning'); return; }
      if (rangeForm.fromDate.value > rangeForm.toDate.value) { showToastSafe('Start date must be before end date', 'warning'); return; }
      drawSalesRangeChart(JSON.parse(localStorage.getItem('kc_orders') || '[]'), rangeForm.fromDate.value, rangeForm.toDate.value);
    });
  }
  if (name === 'settings' && canManageStaff(session)) {
    const configForm = document.getElementById('storeConfigForm');
    if (configForm) configForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveStoreConfig({
        storeName: configForm.storeName.value.trim() || 'KeneCart',
        tagline: configForm.tagline.value.trim() || 'Everything You Need In One Place.',
        currency: configForm.currency.value,
        vatRate: parseFloat(configForm.vatRate.value) || 0,
        deliveryFee: parseFloat(configForm.deliveryFee.value) || 0,
        freeDeliveryThreshold: parseFloat(configForm.freeDeliveryThreshold.value) || 0,
        supportEmail: configForm.supportEmail.value.trim() || 'support@kenecart.com'
      });
      document.getElementById('storeConfigSaveStatus').textContent = 'Saved!';
      showToastSafe('Store configuration updated', 'success');
      setTimeout(() => { const s = document.getElementById('storeConfigSaveStatus'); if (s) s.textContent = ''; }, 2000);
    });

    const accessSelect = document.getElementById('accessWorkerSelect');
    const fillAccessFields = () => {
      const w = getWorkers().find(x => x.employeeId === accessSelect.value);
      if (w) { document.getElementById('accessNewRole').value = w.role; document.getElementById('accessNewLevel').value = w.level; }
    };
    if (accessSelect) { accessSelect.addEventListener('change', fillAccessFields); fillAccessFields(); }

    const accessForm = document.getElementById('workerAccessForm');
    if (accessForm) accessForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const workers = getWorkers();
      const w = workers.find(x => x.employeeId === accessForm.employeeId.value);
      if (!w) return;
      if (w.employeeId === session.employeeId && parseInt(accessForm.newLevel.value, 10) !== 1) {
        if (!confirm('This will remove your own Level 1 admin access. Continue?')) return;
      }
      w.role = accessForm.newRole.value.trim() || w.role;
      w.level = parseInt(accessForm.newLevel.value, 10);
      saveWorkers(workers);
      document.getElementById('workerAccessStatus').textContent = 'Updated!';
      showToastSafe(`${w.fullName}'s access updated to Level ${w.level}`, 'success');
      setTimeout(() => { const s = document.getElementById('workerAccessStatus'); if (s) s.textContent = ''; }, 2000);
    });
  }
}
