/* ===================================================
   KENECART - products.js
   Product listing page: filtering, sorting, pagination.
   Relies on KC.products loaded by app.js (loadProducts).
   =================================================== */

const PRODUCTS_PAGE_SIZE = 12;
let currentPage = 1;
let filteredProducts = [];

function initProductsPage(params) {
  params = params || {};
  const titleMap = {
    'new': 'New Arrivals', 'technology': 'Technology', 'fashion': 'Fashion',
    'home-goods': 'Home Goods', 'beauty': 'Beauty', 'sports': 'Sports'
  };
  const titleEl = document.getElementById('productsPageTitle');
  if (titleEl) {
    if (params.deal === 'flash') titleEl.textContent = 'Flash Deals';
    else if (params.cat && titleMap[params.cat]) titleEl.textContent = titleMap[params.cat];
    else titleEl.textContent = 'Shop All Products';
  }
  // Wait until KC.products is populated (loadProducts is async in app.js)
  const check = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(check);
      populateFilterOptions();
      applyInitialQueryFilters(params);
      applyFilters();
    }
  }, 50);
}

function populateFilterOptions() {
  const categories = [...new Set(KC.products.map(p => p.category))];
  const brands = [...new Set(KC.products.map(p => p.brand))];

  const catBox = document.getElementById('categoryFilters');
  const brandBox = document.getElementById('brandFilters');
  if (catBox) {
    catBox.innerHTML = categories.map(c => `
      <div class="form-check">
        <input class="form-check-input filter-category" type="checkbox" value="${c}" id="cat-${c}">
        <label class="form-check-label small" for="cat-${c}">${c}</label>
      </div>`).join('');
  }
  if (brandBox) {
    brandBox.innerHTML = brands.map(b => `
      <div class="form-check">
        <input class="form-check-input filter-brand" type="checkbox" value="${b}" id="brand-${b}">
        <label class="form-check-label small" for="brand-${b}">${b}</label>
      </div>`).join('');
  }

  document.querySelectorAll('.filter-category, .filter-brand, .filter-rating').forEach(el =>
    el.addEventListener('change', () => { currentPage = 1; applyFilters(); })
  );
  const priceMin = document.getElementById('priceMin');
  const priceMax = document.getElementById('priceMax');
  [priceMin, priceMax].forEach(el => el && el.addEventListener('input', () => { currentPage = 1; applyFilters(); }));

  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) sortSelect.addEventListener('change', applyFilters);

  const searchBox = document.getElementById('productsSearchInput');
  if (searchBox) searchBox.addEventListener('input', () => { currentPage = 1; applyFilters(); });
}

function applyInitialQueryFilters(params) {
  const cat = params.cat;
  const deal = params.deal;
  if (cat && cat !== 'new') {
    const map = { 'technology': 'Technology', 'fashion': 'Fashion', 'home-goods': 'Home Goods', 'beauty': 'Beauty', 'sports': 'Sports' };
    const catName = map[cat];
    if (catName) {
      const box = document.getElementById(`cat-${catName}`);
      if (box) box.checked = true;
    }
  }
  if (deal === 'flash') {
    filteredProducts = KC.products.filter(p => p.section === 'flash');
  }
  const q = params.q;
  if (q) {
    const searchBox = document.getElementById('productsSearchInput');
    if (searchBox) searchBox.value = q;
  }
}

function applyFilters() {
  const checkedCats = [...document.querySelectorAll('.filter-category:checked')].map(c => c.value);
  const checkedBrands = [...document.querySelectorAll('.filter-brand:checked')].map(b => b.value);
  const minPrice = parseFloat(document.getElementById('priceMin')?.value) || 0;
  const maxPrice = parseFloat(document.getElementById('priceMax')?.value) || Infinity;
  const minRating = parseFloat(document.querySelector('.filter-rating:checked')?.value) || 0;
  const query = (document.getElementById('productsSearchInput')?.value || '').toLowerCase().trim();
  const dealOnly = (KC.routeParams && KC.routeParams.deal) === 'flash';
  const newOnly = (KC.routeParams && KC.routeParams.cat) === 'new';

  filteredProducts = KC.products.filter(p => {
    if (dealOnly && p.section !== 'flash') return false;
    if (newOnly && !p.isNew) return false;
    if (checkedCats.length && !checkedCats.includes(p.category)) return false;
    if (checkedBrands.length && !checkedBrands.includes(p.brand)) return false;
    if (p.price < minPrice || p.price > maxPrice) return false;
    if (p.rating < minRating) return false;
    if (query && !(p.name.toLowerCase().includes(query) || p.brand.toLowerCase().includes(query))) return false;
    return true;
  });

  sortProducts();
  renderProductsGrid();
  renderPagination();
}

function sortProducts() {
  const sortBy = document.getElementById('sortSelect')?.value || 'featured';
  switch (sortBy) {
    case 'price-asc': filteredProducts.sort((a, b) => a.price - b.price); break;
    case 'price-desc': filteredProducts.sort((a, b) => b.price - a.price); break;
    case 'rating-desc': filteredProducts.sort((a, b) => b.rating - a.rating); break;
    case 'name-asc': filteredProducts.sort((a, b) => a.name.localeCompare(b.name)); break;
    default: break; // featured = original order
  }
}

function renderProductsGrid() {
  const grid = document.getElementById('productsGrid');
  const resultCount = document.getElementById('resultCount');
  if (!grid) return;

  if (resultCount) resultCount.textContent = `${filteredProducts.length} products found`;

  if (!filteredProducts.length) {
    grid.innerHTML = `<div class="col-12 text-center text-muted py-5">
      <i class="bi bi-search fs-1"></i>
      <p class="mt-2">No products match your filters.</p>
    </div>`;
    return;
  }

  const start = (currentPage - 1) * PRODUCTS_PAGE_SIZE;
  const pageItems = filteredProducts.slice(start, start + PRODUCTS_PAGE_SIZE);
  grid.innerHTML = pageItems.map(p => `<div class="col-6 col-md-4 col-lg-3">${productCardHTML(p)}</div>`).join('');
}

function renderPagination() {
  const pagBox = document.getElementById('pagination');
  if (!pagBox) return;
  const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PAGE_SIZE);
  if (totalPages <= 1) { pagBox.innerHTML = ''; return; }

  const pageBtn = (n, label = n, disabled = false) => `
    <li class="page-item ${n === currentPage ? 'active' : ''} ${disabled ? 'disabled' : ''}">
      <button class="page-link" onclick="goToPage(${n})" ${disabled ? 'tabindex="-1"' : ''}>${label}</button>
    </li>`;
  const ellipsis = `<li class="page-item disabled"><span class="page-link">…</span></li>`;

  let html = pageBtn(Math.max(1, currentPage - 1), '‹ Prev', currentPage === 1);

  // Always show first page
  html += pageBtn(1);

  // Window of pages around current
  const windowStart = Math.max(2, currentPage - 2);
  const windowEnd = Math.min(totalPages - 1, currentPage + 2);
  if (windowStart > 2) html += ellipsis;
  for (let i = windowStart; i <= windowEnd; i++) html += pageBtn(i);
  if (windowEnd < totalPages - 1) html += ellipsis;

  // Always show last page (if more than 1 page)
  if (totalPages > 1) html += pageBtn(totalPages);

  html += pageBtn(Math.min(totalPages, currentPage + 1), 'Next ›', currentPage === totalPages);

  pagBox.innerHTML = html;
}
function goToPage(n) {
  currentPage = n;
  renderProductsGrid();
  renderPagination();
  window.scrollTo({ top: document.getElementById('productsGrid').offsetTop - 100, behavior: 'smooth' });
}

function clearFilters() {
  document.querySelectorAll('.filter-category, .filter-brand, .filter-rating').forEach(el => el.checked = false);
  const priceMin = document.getElementById('priceMin');
  const priceMax = document.getElementById('priceMax');
  if (priceMin) priceMin.value = '';
  if (priceMax) priceMax.value = '';
  const searchBox = document.getElementById('productsSearchInput');
  if (searchBox) searchBox.value = '';
  currentPage = 1;
  applyFilters();
}

document.addEventListener('DOMContentLoaded', initProductsPage);
