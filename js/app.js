/* ===================================================
   KENECART - app.js
   Core app: SPA router, data loading, cart/wishlist
   state, rendering, search, theme, toasts.
   Since all markup lives in one HTML file, navigation
   between "pages" is done by showing/hiding sections
   instead of loading new documents.
   =================================================== */

const KC = {
  products: [],
  cart: JSON.parse(localStorage.getItem('kc_cart') || '[]'),
  wishlist: JSON.parse(localStorage.getItem('kc_wishlist') || '[]'),
  compare: JSON.parse(localStorage.getItem('kc_compare') || '[]'),
  routeParams: {}
};

/* ===================================================
   ROUTER
   =================================================== */
const CUSTOMER_CHROME_PAGES = ['home', 'products', 'cart', 'checkout', 'profile', 'wishlist', 'product-details', 'contact', 'about', 'shipping', 'payment-methods', 'notifications-customer', 'privacy', 'compare', 'help', 'track-order'];

function navigateTo(page, params = {}) {
  // Redirect already-authenticated users away from auth pages
  if ((page === 'customer-login' || page === 'customer-register') && typeof getSession === 'function' && getSession()) {
    page = 'profile';
  }
  if (page === 'worker-login' && typeof getWorkerSession === 'function' && getWorkerSession()) {
    page = 'worker-dashboard';
  }

  KC.routeParams = params || {};
  document.querySelectorAll('.kc-page').forEach(el => el.style.display = 'none');
  const target = document.getElementById('page-' + page);
  if (!target) { console.warn('Unknown page:', page); return; }
  target.style.display = 'block';

  const showChrome = CUSTOMER_CHROME_PAGES.includes(page);
  const header = document.getElementById('globalHeader');
  const footer = document.getElementById('globalFooter');
  if (header) header.style.display = showChrome ? '' : 'none';
  if (footer) footer.style.display = showChrome ? '' : 'none';

  const hash = '#' + page + (params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
  try {
    if (window.location.hash !== hash) history.pushState(null, '', hash);
  } catch (e) {
    console.warn('Could not update URL hash (file:// history API restriction) — navigation still works.', e);
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
  runPageInit(page, KC.routeParams);
  reflectSessionInHeader();
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
}

function runPageInit(page, params) {
  const initializers = {
    'products': () => initProductsPage(params),
    'cart': () => initCartPage(),
    'checkout': () => initCheckoutPage(),
    'profile': () => initProfilePage(),
    'wishlist': () => initWishlistPage(),
    'product-details': () => initProductDetailsPage(params),
    'contact': () => initContactPage(),
    'notifications-customer': () => initCustomerNotificationsPage(),
    'compare': () => initComparePage(),
    'track-order': () => initTrackOrderPage(),
    'worker-dashboard': () => initWorkerDashboard(),
  };
  if (initializers[page]) initializers[page]();
}

function parseHashRoute() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { page: 'home', params: {} };
  const [page, query] = raw.split('?');
  const params = {};
  if (query) new URLSearchParams(query).forEach((v, k) => params[k] = v);
  return { page: page || 'home', params };
}

window.addEventListener('popstate', () => {
  const { page, params } = parseHashRoute();
  navigateTo(page, params);
});

/* ===================================================
   LOADING SCREEN
   =================================================== */
window.addEventListener('load', () => {
  const loader = document.getElementById('loadingScreen');
  if (loader) setTimeout(() => loader.classList.add('hide'), 350);
});

/* ===================================================
   THEME (Light/Dark) — applies site-wide
   =================================================== */
function initTheme() {
  const saved = localStorage.getItem('kc_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kc_theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  document.querySelectorAll('.theme-icon').forEach(icon => {
    icon.className = 'theme-icon bi ' + (theme === 'dark' ? 'bi-sun' : 'bi-moon-stars');
  });
  const darkSwitch = document.getElementById('darkModeSwitch');
  if (darkSwitch) darkSwitch.checked = theme === 'dark';
}

/* ===================================================
   DATA LOADING
   =================================================== */
async function loadProducts() {
  try {
    const res = await fetch('data/products.json');
    KC.products = await res.json();
  } catch (e) {
    console.warn('Could not fetch products.json (likely running from file://).', e);
    KC.products = window.KC_FALLBACK_PRODUCTS || [];
  }
  renderSidebarProducts();
  renderFlashDeals();
  startFlashTimers();
}

/* ---------- Home page: sidebar "Sports" grid ---------- */
function renderSidebarProducts() {
  const container = document.getElementById('sidebarProducts');
  if (!container) return;
  const items = KC.products.filter(p => p.section === 'sidebar');
  container.innerHTML = items.map(p => productCardHTML(p)).join('');
}

/* ---------- Home page: Flash deals ---------- */
function renderFlashDeals() {
  const container = document.getElementById('flashDeals');
  if (!container) return;
  const items = KC.products.filter(p => p.section === 'flash');
  container.innerHTML = items.map(p => productCardHTML(p, true)).join('');
}
function startFlashTimers() {
  document.querySelectorAll('.flash-timer').forEach(el => {
    let seconds = parseInt(el.dataset.seconds, 10);
    if (isNaN(seconds)) return;
    setInterval(() => {
      seconds = Math.max(0, seconds - 1);
      const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      el.textContent = `${h}:${m}`;
      el.dataset.seconds = seconds;
    }, 60000);
  });
}

/* ---------- Product card template (shared across pages) ---------- */
function productCardHTML(p, isFlash = false) {
  const inWishlist = KC.wishlist.includes(p.id);
  const stars = renderStars(p.rating);
  const hours = isFlash ? Math.floor((p.timerSeconds || 0) / 3600) : 0;
  const mins = isFlash ? Math.floor(((p.timerSeconds || 0) % 3600) / 60) : 0;
  const stockLabel = p.stock === 0
    ? `<span class="stock-status text-danger">Out of stock</span>`
    : p.stock < 15
      ? `<span class="stock-status text-warning">Low stock: ${p.stock} left</span>`
      : `<span class="stock-status text-success">In stock</span>`;

  return `
  <div class="kc-product-card" data-id="${p.id}">
    ${p.discount ? `<span class="badge-discount">-${p.discount}%</span>` : ''}
    ${isFlash ? `<span class="flash-timer" data-seconds="${p.timerSeconds || 0}">${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}</span>` : ''}
    <button class="wishlist-btn ${inWishlist ? 'active' : ''}" onclick="toggleWishlist('${p.id}', this)" aria-label="Toggle wishlist">
      <i class="bi ${inWishlist ? 'bi-heart-fill' : 'bi-heart'}"></i>
    </button>
    <div class="img-wrap" onclick="viewProduct('${p.id}')" role="button">
      <img src="${p.image}" alt="${p.name}" loading="lazy">
    </div>
    <div class="brand">${p.brand}</div>
    <div class="name" onclick="viewProduct('${p.id}')" role="button">${p.name}</div>
    <div class="kc-stars">${stars} <span class="text-muted" style="font-size:.72rem">(${p.reviews})</span></div>
    <div class="price-row">
      <span class="price">$${p.price.toFixed(2)}</span>
      ${p.oldPrice ? `<span class="old-price">$${p.oldPrice.toFixed(2)}</span>` : ''}
    </div>
    ${stockLabel}
    <button class="btn-add-cart" onclick="addToCart('${p.id}')">
      <i class="bi bi-cart-plus"></i> Add to Cart
    </button>
    <div class="pay-hint">1-click e-pay available</div>
    <div class="actions-row">
      <button onclick="viewProduct('${p.id}')"><i class="bi bi-eye"></i> View</button>
      <button class="${KC.compare.includes(p.id) ? 'active' : ''}" onclick="toggleCompare('${p.id}', this)"><i class="bi bi-arrow-left-right"></i> Compare</button>
    </div>
  </div>`;
}
function renderStars(rating) {
  const full = Math.round(rating);
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<i class="bi ${i <= full ? 'bi-star-fill' : 'bi-star'}"></i>`;
  return out;
}

/* ===================================================
   CART
   =================================================== */
function addToCart(id) {
  const existing = KC.cart.find(i => i.id === id);
  if (existing) existing.qty += 1;
  else KC.cart.push({ id, qty: 1 });
  persist('kc_cart', KC.cart);
  updateCartBadge();
  showToast('Added to cart', 'success');
}
function updateCartBadge() {
  const count = KC.cart.reduce((sum, i) => sum + i.qty, 0);
  document.querySelectorAll('#cartCount').forEach(b => b.textContent = count);
}

/* ===================================================
   WISHLIST
   =================================================== */
function toggleWishlist(id, btnEl) {
  const idx = KC.wishlist.indexOf(id);
  if (idx > -1) {
    KC.wishlist.splice(idx, 1);
    showToast('Removed from wishlist', 'info');
  } else {
    KC.wishlist.push(id);
    showToast('Added to wishlist', 'success');
  }
  persist('kc_wishlist', KC.wishlist);
  updateWishlistBadge();
  if (btnEl) {
    const active = KC.wishlist.includes(id);
    btnEl.classList.toggle('active', active);
    btnEl.querySelector('i').className = `bi ${active ? 'bi-heart-fill' : 'bi-heart'}`;
  }
}
function updateWishlistBadge() {
  document.querySelectorAll('#wishlistCount').forEach(b => b.textContent = KC.wishlist.length);
}

/* ===================================================
   COMPARE
   =================================================== */
function toggleCompare(id, btnEl) {
  const idx = KC.compare.indexOf(id);
  if (idx > -1) {
    KC.compare.splice(idx, 1);
    showToast('Removed from comparison', 'info');
  } else {
    if (KC.compare.length >= 4) { showToast('You can compare up to 4 products', 'warning'); return; }
    KC.compare.push(id);
    showToast('Added to comparison — view it via the compare icon in the header', 'success');
  }
  persist('kc_compare', KC.compare);
  updateCompareBadge();
  if (btnEl) btnEl.classList.toggle('active', KC.compare.includes(id));
}
function updateCompareBadge() {
  document.querySelectorAll('#compareCount').forEach(b => b.textContent = KC.compare.length);
}
function clearCompare() {
  KC.compare = [];
  persist('kc_compare', KC.compare);
  updateCompareBadge();
  initComparePage();
}
function initComparePage() {
  const check = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(check);
      renderComparePage();
    }
  }, 50);
}
function renderComparePage() {
  const wrap = document.getElementById('compareTableWrap');
  const empty = document.getElementById('compareEmpty');
  if (!wrap) return;
  const items = KC.compare.map(id => KC.products.find(p => p.id === id)).filter(Boolean);

  if (!items.length) {
    wrap.innerHTML = '';
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');

  const rows = [
    ['Image', p => `<img src="${p.image}" alt="${p.name}" style="width:90px;height:90px;object-fit:cover;border-radius:8px">`],
    ['Name', p => p.name],
    ['Brand', p => p.brand],
    ['Category', p => p.category],
    ['Price', p => `$${p.price.toFixed(2)}${p.oldPrice ? ` <span class="text-muted text-decoration-line-through small">$${p.oldPrice.toFixed(2)}</span>` : ''}`],
    ['Rating', p => `${renderStars(p.rating)} <span class="text-muted small">(${p.reviews})</span>`],
    ['Stock', p => p.stock > 0 ? `${p.stock} available` : '<span class="text-danger">Out of stock</span>'],
    ['', p => `<button class="btn btn-primary btn-sm" onclick="addToCart('${p.id}')">Add to Cart</button> <button class="btn btn-outline-danger btn-sm" onclick="toggleCompare('${p.id}'); renderComparePage();"><i class="bi bi-x"></i></button>`]
  ];

  wrap.innerHTML = `<table class="table align-middle bg-white rounded-3 overflow-hidden">
    <tbody>
      ${rows.map(([label, fn]) => `
        <tr>
          ${label ? `<th class="text-muted small text-uppercase" style="width:120px">${label}</th>` : '<th></th>'}
          ${items.map(p => `<td>${fn(p)}</td>`).join('')}
        </tr>`).join('')}
    </tbody>
  </table>`;
}

/* ===================================================
   PRODUCT DETAILS PAGE
   =================================================== */
function viewProduct(id) { navigateTo('product-details', { id }); }

function initProductDetailsPage(params) {
  const check = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(check);
      const p = KC.products.find(prod => prod.id === params.id) || KC.products[0];
      renderProductDetail(p);
    }
  }, 50);
}
function renderProductDetail(p) {
  const root = document.getElementById('productDetailRoot');
  if (!root || !p) return;
  const reviews = JSON.parse(localStorage.getItem('kc_reviews_' + p.id) || '[]');
  root.innerHTML = `
    <div class="row g-4">
      <div class="col-12 col-md-6">
        <img src="${p.image}" class="w-100 rounded-3" style="aspect-ratio:1/1;object-fit:cover" alt="${p.name}">
      </div>
      <div class="col-12 col-md-6">
        <div class="text-muted small text-uppercase">${p.brand} · ${p.category}</div>
        <h1 class="fs-3 fw-bold">${p.name}</h1>
        <div class="kc-stars mb-2">${renderStars(p.rating)} <span class="text-muted small">(${p.reviews} reviews)</span></div>
        <div class="d-flex align-items-baseline gap-2 mb-3">
          <span class="fs-3 fw-bold">$${p.price.toFixed(2)}</span>
          ${p.oldPrice ? `<span class="text-muted text-decoration-line-through">$${p.oldPrice.toFixed(2)}</span>` : ''}
        </div>
        <p class="text-muted">${p.stock > 0 ? `In stock — ${p.stock} available` : 'Out of stock'}</p>
        <div class="d-flex gap-2 mb-3">
          <button class="btn btn-primary flex-grow-1" onclick="addToCart('${p.id}')"><i class="bi bi-cart-plus"></i> Add to Cart</button>
          <button class="btn btn-outline-secondary" onclick="toggleWishlist('${p.id}', this)"><i class="bi bi-heart"></i></button>
          <button class="btn btn-outline-secondary ${KC.compare.includes(p.id) ? 'active' : ''}" onclick="toggleCompare('${p.id}', this)"><i class="bi bi-arrow-left-right"></i></button>
        </div>
        <p class="small text-muted">Free returns within 30 days. Secure checkout with card, PayPal, Apple Pay, Google Pay, or Cash on Delivery.</p>
      </div>
    </div>
    <hr class="my-4">
    <div class="row">
      <div class="col-12 col-lg-8">
        <h2 class="fs-5 fw-bold mb-3">Customer Reviews</h2>
        <div id="reviewsList">
          ${reviews.length ? reviews.map(r => `
            <div class="border-bottom py-2">
              <div class="fw-semibold small">${r.name} <span class="text-muted fw-normal">— ${new Date(r.date).toLocaleDateString()}</span></div>
              <div class="kc-stars">${renderStars(r.rating)}</div>
              <p class="small mb-0">${escapeHTML(r.text)}</p>
            </div>`).join('') : `<p class="text-muted small">No reviews yet. Be the first to review this product.</p>`}
        </div>
        <form id="reviewForm" class="mt-3">
          <label class="form-label small fw-semibold">Leave a review</label>
          <select class="form-select form-select-sm mb-2" id="reviewRating" style="max-width:160px">
            <option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option>
          </select>
          <textarea class="form-control form-control-sm mb-2" id="reviewText" rows="2" placeholder="Share your experience..." required></textarea>
          <button class="btn btn-primary btn-sm" type="submit">Submit Review</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('reviewForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const session = typeof getSession === 'function' ? getSession() : null;
    const newReview = {
      name: session ? session.name : 'Guest',
      rating: parseInt(document.getElementById('reviewRating').value, 10),
      text: document.getElementById('reviewText').value.trim(),
      date: new Date().toISOString()
    };
    const key = 'kc_reviews_' + p.id;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push(newReview);
    localStorage.setItem(key, JSON.stringify(list));
    showToast('Review submitted', 'success');
    renderProductDetail(p);
  });
}

/* ===================================================
   WISHLIST PAGE
   =================================================== */
function initWishlistPage() {
  const check = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(check);
      const grid = document.getElementById('wishlistGrid');
      const empty = document.getElementById('wishlistEmpty');
      if (!grid) return;
      const items = KC.products.filter(p => KC.wishlist.includes(p.id));
      empty.classList.toggle('d-none', items.length > 0);
      grid.innerHTML = items.map(p => `<div class="col-6 col-md-4 col-lg-3">${productCardHTML(p)}</div>`).join('');
    }
  }, 50);
}

function collapseCategoryNav() {
  const nav = document.getElementById('kcCategoryNav');
  if (!nav || !nav.classList.contains('show')) return;
  const collapseInstance = bootstrap.Collapse.getOrCreateInstance(nav);
  collapseInstance.hide();
}

function goToCheckoutWithMethod(method) {
  if (!KC.cart.length) {
    showToast('Add something to your cart first', 'info');
    navigateTo('products');
    return;
  }
  KC.pendingPaymentMethod = method;
  navigateTo('checkout');
}

/* ===================================================
   PROFILE PAGE
   =================================================== */
function initProfilePage() {
  requireAuth();
  const session = getSession();
  if (!session) return;
  const users = getUsers();
  const currentUser = users.find(u => u.id === session.id);
  if (!currentUser) return;

  function loadProfile() {
    document.getElementById('profileAvatar').src = currentUser.avatar;
    document.getElementById('profileName').textContent = currentUser.name;
    document.getElementById('profileEmail').textContent = currentUser.email;
    const form = document.getElementById('editProfileForm');
    form.name.value = currentUser.name;
    form.email.value = currentUser.email;
    form.phone.value = currentUser.phone || '';
    form.avatar.value = currentUser.avatar || '';
  }
  loadProfile();
  showProfileTab('detailsTab');

  const form = document.getElementById('editProfileForm');
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  newForm.addEventListener('submit', (e) => {
    e.preventDefault();
    currentUser.name = newForm.name.value.trim();
    currentUser.email = newForm.email.value.trim().toLowerCase();
    currentUser.phone = newForm.phone.value.trim();
    if (newForm.avatar.value.trim()) currentUser.avatar = newForm.avatar.value.trim();
    const allUsers = getUsers().map(u => u.id === currentUser.id ? currentUser : u);
    saveUsers(allUsers);
    setSession(currentUser);
    loadProfile();
    showToast('Profile updated', 'success');
  });

  renderOrderHistory(currentUser);
}
function showProfileTab(id) {
  document.getElementById('detailsTab')?.classList.toggle('d-none', id !== 'detailsTab');
  document.getElementById('ordersTab')?.classList.toggle('d-none', id !== 'ordersTab');
  document.querySelectorAll('#page-profile .list-group-item').forEach(el => el.classList.remove('active'));
  const btn = document.querySelector(`#page-profile .list-group-item[data-tab="${id}"]`);
  if (btn) btn.classList.add('active');
}
function orderStatusBadgeClass(status) {
  const map = {
    'Processing': 'bg-primary', 'Pending': 'bg-secondary', 'Shipped': 'bg-info text-dark',
    'Out for Delivery': 'bg-warning text-dark', 'Delivered': 'bg-success', 'Cancelled': 'bg-danger'
  };
  return map[status] || 'bg-primary';
}
function renderOrderHistory(currentUser) {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]').filter(o => (currentUser.orders || []).includes(o.id));
  const box = document.getElementById('ordersList');
  if (!box) return;
  if (!orders.length) {
    box.innerHTML = `<p class="text-muted small">No orders yet. <a href="#" onclick="navigateTo('products'); return false;">Start shopping</a>.</p>`;
    return;
  }
  box.innerHTML = orders.reverse().map(o => `
    <div class="border rounded-3 p-3 mb-3">
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <div><div class="fw-bold">${o.id}</div><div class="text-muted small">${new Date(o.date).toLocaleString()}</div></div>
        <span class="badge ${orderStatusBadgeClass(o.status)} align-self-start">${o.status}</span>
      </div>
      <hr>
      ${o.items.map(i => `<div class="d-flex justify-content-between small mb-1"><span>${i.name} × ${i.qty}</span><span>$${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
      <div class="d-flex justify-content-between fw-bold mt-2"><span>Total</span><span>$${o.total.toFixed(2)}</span></div>
      <button class="btn btn-sm btn-outline-secondary mt-2" onclick="downloadReceipt('${o.id}')"><i class="bi bi-download"></i> Download Receipt</button>
    </div>
  `).join('');
}
function downloadReceipt(orderId) {
  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  const lines = [
    `KeneCart Receipt`, `Order ID: ${order.id}`, `Date: ${new Date(order.date).toLocaleString()}`, '',
    ...order.items.map(i => `${i.name} x${i.qty} - $${(i.price*i.qty).toFixed(2)}`), '',
    `Total: $${order.total.toFixed(2)}`, `Payment: ${order.paymentMethod}`
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${order.id}-receipt.txt`;
  a.click();
}

/* ===================================================
   TRACK ORDER (no login required)
   =================================================== */
function initTrackOrderPage() {
  const resultBox = document.getElementById('trackOrderResult');
  resultBox.innerHTML = '';
  const form = document.getElementById('trackOrderForm');
  const freshForm = form.cloneNode(true);
  form.parentNode.replaceChild(freshForm, form);

  freshForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const orderId = freshForm.orderId.value.trim().toUpperCase();
    const email = freshForm.email.value.trim().toLowerCase();
    const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
    const order = orders.find(o => o.id.toUpperCase() === orderId && o.shipping?.email?.toLowerCase() === email);

    if (!order) {
      resultBox.innerHTML = `<div class="alert alert-danger">We couldn't find an order matching that ID and email. Double-check both and try again, or <a href="#" onclick="navigateTo('contact'); return false;">contact support</a>.</div>`;
      return;
    }

    const steps = ['Processing', 'Shipped', 'Out for Delivery', 'Delivered'];
    const currentStep = steps.indexOf(order.status) > -1 ? steps.indexOf(order.status) : 0;

    resultBox.innerHTML = `
      <div class="p-4 rounded-3 border" style="background:var(--kc-secondary)">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div><div class="fw-bold">${order.id}</div><div class="text-muted small">${new Date(order.date).toLocaleString()}</div></div>
          <span class="badge bg-primary">${order.status}</span>
        </div>
        <div class="d-flex justify-content-between mb-4">
          ${steps.map((s, i) => `
            <div class="text-center flex-fill">
              <div class="rounded-circle mx-auto mb-1 d-flex align-items-center justify-content-center" style="width:28px;height:28px;background:${i <= currentStep ? 'var(--kc-primary)' : 'var(--kc-border)'};color:#fff;font-size:.75rem">${i <= currentStep ? '✓' : i+1}</div>
              <div class="small ${i <= currentStep ? 'fw-semibold' : 'text-muted'}">${s}</div>
            </div>`).join('')}
        </div>
        <hr>
        ${order.items.map(i => `<div class="d-flex justify-content-between small mb-1"><span>${i.name} × ${i.qty}</span><span>$${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
        <div class="d-flex justify-content-between fw-bold mt-2"><span>Total</span><span>$${order.total.toFixed(2)}</span></div>
      </div>`;
  });
}

/* ===================================================
   CONTACT / SUPPORT PAGE
   =================================================== */
function initContactPage() {
  const form = document.getElementById('contactForm');
  const successBox = document.getElementById('contactSuccess');
  successBox.classList.add('d-none');

  // Prefill from session if logged in
  const session = typeof getSession === 'function' ? getSession() : null;
  if (session) {
    form.name.value = session.name || '';
    form.email.value = session.email || '';
  }

  // Avoid stacking duplicate listeners across repeated visits
  const freshForm = form.cloneNode(true);
  form.parentNode.replaceChild(freshForm, form);

  freshForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const ticket = {
      id: 'TCK-' + Date.now().toString(36).toUpperCase(),
      name: freshForm.name.value.trim(),
      email: freshForm.email.value.trim(),
      orderId: freshForm.orderId.value.trim(),
      topic: freshForm.topic.value,
      message: freshForm.message.value.trim(),
      date: new Date().toISOString(),
      status: 'Open'
    };
    const tickets = JSON.parse(localStorage.getItem('kc_support_tickets') || '[]');
    tickets.push(ticket);
    localStorage.setItem('kc_support_tickets', JSON.stringify(tickets));

    document.getElementById('contactSuccess').classList.remove('d-none');
    freshForm.reset();
    if (session) { freshForm.name.value = session.name || ''; freshForm.email.value = session.email || ''; }
    showToast('Message sent to customer support', 'success');
    renderMyTickets();
  });

  renderMyTickets();
}
function renderMyTickets() {
  const box = document.getElementById('myTicketsList');
  if (!box) return;
  const session = typeof getSession === 'function' ? getSession() : null;

  if (!session) {
    box.innerHTML = `<p class="text-muted small mb-0">Sign in to see your past support messages here.</p>`;
    return;
  }

  const tickets = JSON.parse(localStorage.getItem('kc_support_tickets') || '[]');
  const mine = tickets.filter(t => t.email.toLowerCase() === session.email.toLowerCase());

  if (!mine.length) { box.innerHTML = `<p class="text-muted small mb-0">No messages sent yet.</p>`; return; }
  box.innerHTML = mine.reverse().map(t => `
    <div class="border-bottom py-2">
      <div class="d-flex justify-content-between">
        <span class="small fw-semibold">${escapeHTML(t.topic)}</span>
        <span class="badge bg-secondary">${t.status}</span>
      </div>
      <div class="text-muted small">${t.id} · ${new Date(t.date).toLocaleDateString()}</div>
    </div>
  `).join('');
}

/* ===================================================
   CUSTOMER NOTIFICATIONS
   Messages sent by KeneCart staff (from the worker
   dashboard's Messages section) appear here for
   customers — either broadcast to everyone or targeted
   at a specific customer email.
   =================================================== */
const CUSTOMER_NOTIF_KEY = 'kc_customer_notifications';

function getCustomerNotifications() {
  return JSON.parse(localStorage.getItem(CUSTOMER_NOTIF_KEY) || '[]');
}
function saveCustomerNotifications(list) {
  localStorage.setItem(CUSTOMER_NOTIF_KEY, JSON.stringify(list));
}
function ensureCustomerNotificationsSeeded() {
  if (localStorage.getItem(CUSTOMER_NOTIF_KEY)) return;
  saveCustomerNotifications([
    { id: 'N-001', toEmail: 'all', text: 'Welcome to KeneCart! Enjoy free delivery on orders over $50.', date: new Date().toISOString(), icon: 'bi-gift' },
    { id: 'N-002', toEmail: 'all', text: 'Flash Deals just dropped — up to 40% off select tech.', date: new Date().toISOString(), icon: 'bi-lightning-charge' }
  ]);
}

function notificationsForCurrentUser() {
  const session = typeof getSession === 'function' ? getSession() : null;
  const all = getCustomerNotifications();
  return all.filter(n => n.toEmail === 'all' || (session && n.toEmail === session.email));
}

function updateNotifBadge() {
  const badge = document.getElementById('notifCount');
  if (!badge) return;
  const session = typeof getSession === 'function' ? getSession() : null;
  const readKey = session ? `kc_notif_read_${session.email}` : null;
  const readIds = readKey ? JSON.parse(localStorage.getItem(readKey) || '[]') : [];
  const mine = notificationsForCurrentUser();
  const unread = mine.filter(n => !readIds.includes(n.id)).length;
  badge.textContent = unread;
}

function initCustomerNotificationsPage() {
  ensureCustomerNotificationsSeeded();
  const session = typeof getSession === 'function' ? getSession() : null;
  const box = document.getElementById('customerNotifList');
  const mine = notificationsForCurrentUser().slice().reverse();

  if (!mine.length) {
    box.innerHTML = `<p class="text-muted small mb-0">No notifications yet.</p>`;
    return;
  }
  box.innerHTML = mine.map(n => `
    <div class="d-flex align-items-start gap-2 py-2 border-bottom">
      <i class="bi ${n.icon || 'bi-bell'} text-primary"></i>
      <div><div class="small">${escapeHTML(n.text)}</div><div class="text-muted small">${new Date(n.date).toLocaleString()}</div></div>
    </div>
  `).join('');

  // Mark as read for this session
  if (session) {
    const readKey = `kc_notif_read_${session.email}`;
    const readIds = JSON.parse(localStorage.getItem(readKey) || '[]');
    mine.forEach(n => { if (!readIds.includes(n.id)) readIds.push(n.id); });
    localStorage.setItem(readKey, JSON.stringify(readIds));
  }
  updateNotifBadge();
}

/* ===================================================
   SEARCH SUGGESTIONS
   =================================================== */
function initSearch() {
  const input = document.getElementById('searchInput');
  const box = document.getElementById('searchSuggestions');
  if (!input || !box) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
    const matches = KC.products.filter(p =>
      p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    ).slice(0, 6);

    box.innerHTML = matches.length ? matches.map(p => `
        <div class="suggestion-item" onclick="viewProduct('${p.id}')">
          <img src="${p.image}" alt="" width="34" height="34" style="object-fit:cover;border-radius:6px">
          <div>
            <div style="font-size:.82rem;font-weight:600">${p.name}</div>
            <div style="font-size:.72rem;color:var(--kc-text-muted)">${p.category} · $${p.price.toFixed(2)}</div>
          </div>
        </div>`).join('') : `<div class="suggestion-item text-muted">No results for "${escapeHTML(q)}"</div>`;
    box.classList.add('show');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      box.classList.remove('show');
      navigateTo('products', q ? { q } : {});
    }
  });

  document.addEventListener('click', (e) => {
    if (!box.contains(e.target) && e.target !== input) box.classList.remove('show');
  });
}
function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

/* ===================================================
   TOASTS
   =================================================== */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const colors = { success: 'text-bg-success', info: 'text-bg-primary', warning: 'text-bg-warning', danger: 'text-bg-danger' };
  const el = document.createElement('div');
  el.className = `toast align-items-center ${colors[type] || colors.info} border-0`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="d-flex">
      <div class="toast-body">${escapeHTML(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  container.appendChild(el);
  const toast = new bootstrap.Toast(el, { delay: 2500 });
  toast.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
function showToastSafe(msg, type) { if (typeof showToast === 'function') showToast(msg, type); }

/* ===================================================
   PAYMENTS POPOVER (dismissible, matches reference)
   =================================================== */
function initPaymentsPopover() {
  const pop = document.getElementById('paymentsPopover');
  const closeBtn = document.getElementById('closePaymentsPopover');
  if (!pop || !closeBtn) return;
  if (sessionStorage.getItem('kc_hide_payments_popover') === '1') { pop.remove(); return; }
  closeBtn.addEventListener('click', () => {
    pop.remove();
    sessionStorage.setItem('kc_hide_payments_popover', '1');
  });
}

/* ===================================================
   MISC HELPERS
   =================================================== */
function persist(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function reflectSessionInHeader() {
  const session = typeof getSession === 'function' ? getSession() : null;
  document.querySelectorAll('#accountLink').forEach(link => {
    if (session) {
      link.setAttribute('onclick', "navigateTo('profile'); return false;");
      link.href = '#profile';
      link.title = session.name;
    } else {
      link.setAttribute('onclick', "navigateTo('customer-login'); return false;");
      link.href = '#customer-login';
      link.title = 'Account';
    }
  });
}

/* ===================================================
   INIT
   =================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadProducts();
  if (typeof ensureCustomersSeeded === 'function') ensureCustomersSeeded();
  initSearch();
  initPaymentsPopover();
  updateCartBadge();
  updateWishlistBadge();
  updateCompareBadge();
  ensureCustomerNotificationsSeeded();
  updateNotifBadge();

  document.querySelectorAll('.theme-toggle-btn').forEach(btn => btn.addEventListener('click', toggleTheme));

  // Static auth forms (present in DOM from page load, not dynamically rendered)
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
  document.getElementById('forgotForm')?.addEventListener('submit', handleForgotPassword);
  document.getElementById('workerLoginForm')?.addEventListener('submit', handleWorkerLogin);

  // Always start at Home on a fresh page load/refresh — a stale hash left over from a
  // previous visit (e.g. "#cart") should not hijack where the site opens. Wrapped in
  // try/catch because some browsers throw a SecurityError on history.replaceState for
  // file:// pages, which would otherwise silently abort this whole callback and leave
  // whatever page the stale hash pointed to on screen.
  try {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (e) {
    console.warn('Could not clear URL hash (file:// history API restriction) — proceeding anyway.', e);
  }
  navigateTo('home');
});

// Catch browser back-forward cache (bfcache) restores. Some browsers, when reopening
// a previously-visited tab, skip re-running page-load scripts entirely and just resume
// the exact prior visual state (including whatever page was showing and the URL hash).
// DOMContentLoaded does NOT fire again in that case — only 'pageshow' with persisted=true.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    try {
      if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* file:// restriction — harmless */ }
    navigateTo('home');
  }
});

function showAuthPane(id) {
  document.getElementById('loginPane')?.classList.add('d-none');
  document.getElementById('forgotPane')?.classList.add('d-none');
  document.getElementById(id)?.classList.remove('d-none');
}
