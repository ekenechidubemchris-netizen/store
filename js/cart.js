/* ===================================================
   KENECART - cart.js
   Cart page: render line items, quantity controls,
   coupon codes, delivery fee, VAT, totals.
   =================================================== */

function getActiveStoreConfig() {
  return JSON.parse(localStorage.getItem('kc_store_config') || 'null') || {
    storeName: 'KeneCart', vatRate: 7.5, deliveryFee: 4.99, freeDeliveryThreshold: 50
  };
}

const COUPONS = {
  'KENE10': { type: 'percent', value: 10, label: '10% off' },
  'SAVE5': { type: 'flat', value: 5, label: '$5 off' },
};

function initCartPage() {
  const check = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(check);
      renderCartItems();
      renderCartSummary();
    }
  }, 50);

  const couponForm = document.getElementById('couponForm');
  if (couponForm) couponForm.addEventListener('submit', applyCoupon);
}

function getCartLineItems() {
  return KC.cart.map(item => {
    const product = KC.products.find(p => p.id === item.id);
    return product ? { ...product, qty: item.qty } : null;
  }).filter(Boolean);
}

function renderCartItems() {
  const container = document.getElementById('cartItems');
  const emptyState = document.getElementById('cartEmptyState');
  if (!container) return;
  const items = getCartLineItems();

  if (!items.length) {
    container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('d-none');
    return;
  }
  if (emptyState) emptyState.classList.add('d-none');

  container.innerHTML = items.map(item => `
    <div class="d-flex gap-3 align-items-center border-bottom py-3" data-id="${item.id}">
      <img src="${item.image}" alt="${item.name}" style="width:76px;height:76px;object-fit:cover;border-radius:8px">
      <div class="flex-grow-1">
        <div class="fw-semibold small">${item.name}</div>
        <div class="text-muted small">${item.brand}</div>
        <div class="fw-bold">$${item.price.toFixed(2)}</div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <button class="btn btn-sm btn-outline-secondary" onclick="changeQty('${item.id}', -1)">−</button>
        <span class="fw-semibold" style="min-width:20px;text-align:center">${item.qty}</span>
        <button class="btn btn-sm btn-outline-secondary" onclick="changeQty('${item.id}', 1)">+</button>
      </div>
      <div class="fw-bold" style="min-width:70px;text-align:right">$${(item.price * item.qty).toFixed(2)}</div>
      <button class="btn btn-sm text-danger" onclick="removeFromCart('${item.id}')" title="Remove"><i class="bi bi-trash"></i></button>
    </div>
  `).join('');
}

function changeQty(id, delta) {
  const item = KC.cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    KC.cart = KC.cart.filter(i => i.id !== id);
  }
  persist('kc_cart', KC.cart);
  updateCartBadge();
  renderCartItems();
  renderCartSummary();
}

function removeFromCart(id) {
  KC.cart = KC.cart.filter(i => i.id !== id);
  persist('kc_cart', KC.cart);
  updateCartBadge();
  renderCartItems();
  renderCartSummary();
  showToast('Item removed from cart', 'info');
}

function applyCoupon(e) {
  e.preventDefault();
  const input = document.getElementById('couponInput');
  const code = input.value.trim().toUpperCase();
  const feedback = document.getElementById('couponFeedback');
  if (COUPONS[code]) {
    localStorage.setItem('kc_active_coupon', code);
    feedback.className = 'small text-success mt-1';
    feedback.textContent = `Coupon applied: ${COUPONS[code].label}`;
  } else {
    localStorage.removeItem('kc_active_coupon');
    feedback.className = 'small text-danger mt-1';
    feedback.textContent = 'Invalid coupon code.';
  }
  renderCartSummary();
}

function renderCartSummary() {
  const summaryBox = document.getElementById('cartSummary');
  if (!summaryBox) return;
  const items = getCartLineItems();
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  const couponCode = localStorage.getItem('kc_active_coupon');
  const coupon = couponCode && COUPONS[couponCode];
  let discount = 0;
  if (coupon) discount = coupon.type === 'percent' ? subtotal * (coupon.value / 100) : coupon.value;
  discount = Math.min(discount, subtotal);

  const cfg = getActiveStoreConfig();
  const vat = (subtotal - discount) * (cfg.vatRate / 100);
  const delivery = subtotal === 0 ? 0 : (subtotal >= cfg.freeDeliveryThreshold ? 0 : cfg.deliveryFee);
  const total = subtotal - discount + vat + delivery;

  summaryBox.innerHTML = `
    <div class="d-flex justify-content-between small mb-2"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
    ${coupon ? `<div class="d-flex justify-content-between small mb-2 text-success"><span>Discount (${couponCode})</span><span>−$${discount.toFixed(2)}</span></div>` : ''}
    <div class="d-flex justify-content-between small mb-2"><span>VAT (${cfg.vatRate}%)</span><span>$${vat.toFixed(2)}</span></div>
    <div class="d-flex justify-content-between small mb-2"><span>Delivery</span><span>${delivery === 0 ? 'Free' : '$' + delivery.toFixed(2)}</span></div>
    <hr>
    <div class="d-flex justify-content-between fw-bold fs-5 mb-3"><span>Total</span><span>$${total.toFixed(2)}</span></div>
    <a href="#" onclick="navigateTo('checkout'); return false;" class="btn btn-primary w-100 fw-semibold ${items.length ? '' : 'disabled'}">Proceed to Checkout</a>
  `;
}

document.addEventListener('DOMContentLoaded', initCartPage);
