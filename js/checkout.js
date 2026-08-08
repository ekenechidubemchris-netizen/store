/* ===================================================
   KENECART - checkout.js
   Checkout flow: shipping info, demo payment methods,
   order placement, receipt generation.
   =================================================== */

function initCheckoutPage() {
  // Require an account before completing checkout. Cart is preserved (it's just
  // sitting in localStorage), so nothing is lost — they just need to sign in or
  // register first, then get sent straight back here.
  if (typeof getSession === 'function' && !getSession()) {
    showToastSafe('Please sign in or create an account to complete your order', 'warning');
    sessionStorage.setItem('kc_redirect_after_login', 'checkout');
    navigateTo('customer-login');
    return;
  }

  // Reset visibility state from any previous order — without this, completing one
  // order permanently hides the checkout form on every future visit to this page.
  document.getElementById('checkoutFormWrap')?.classList.remove('d-none');
  document.getElementById('orderConfirmation')?.classList.add('d-none');

  const check = setInterval(() => {
    if (KC.products && KC.products.length) {
      clearInterval(check);
      if (!KC.cart.length) {
        navigateTo('cart');
        return;
      }
      renderCheckoutSummary();
    }
  }, 50);

  const form = cloneToClearListeners('checkoutForm');
  if (form) form.addEventListener('submit', placeOrder);

  document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.addEventListener('change', togglePaymentFields);
  });
  togglePaymentFields();
  initWalletConfirmButtons();
  showSavedPaymentBanner();

  // If arriving from the Payment Methods info page with a specific method requested
  if (KC.pendingPaymentMethod) {
    const radio = document.querySelector(`input[name="paymentMethod"][value="${KC.pendingPaymentMethod}"]`);
    if (radio) { radio.checked = true; togglePaymentFields(); }
    KC.pendingPaymentMethod = null;
  }

  // Prefill from session if logged in
  const session = getSession();
  if (session) {
    const nameField = document.getElementById('fullName');
    const emailField = document.getElementById('email');
    if (nameField) nameField.value = session.name;
    if (emailField) emailField.value = session.email;
  }
}

function showSavedPaymentBanner() {
  const banner = document.getElementById('savedPaymentBanner');
  if (!banner) return;
  const session = typeof getSession === 'function' ? getSession() : null;
  if (!session) { banner.classList.add('d-none'); banner.innerHTML = ''; return; }

  const users = getUsers();
  const user = users.find(u => u.id === session.id);
  const saved = user?.lastPaymentMethod;
  if (!saved) { banner.classList.add('d-none'); banner.innerHTML = ''; return; }

  const labels = {
    card: saved.cardLast4 ? `${(saved.cardBrand || 'Card').toUpperCase()} •••• ${saved.cardLast4}` : 'Card',
    paypal: 'PayPal', applepay: 'Apple Pay', googlepay: 'Google Pay',
    banktransfer: 'Bank Transfer', cod: 'Cash on Delivery'
  };
  const label = labels[saved.method] || saved.method;

  banner.classList.remove('d-none');
  banner.innerHTML = `
    <div class="alert alert-primary d-flex justify-content-between align-items-center flex-wrap gap-2 py-2 mb-3">
      <span class="small">You last paid with <strong>${label}</strong>.</span>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-primary btn-sm" id="reuseSavedPaymentBtn">Use this again</button>
        <button type="button" class="btn btn-outline-secondary btn-sm" id="chooseNewPaymentBtn">Choose a different method</button>
      </div>
    </div>`;

  document.getElementById('reuseSavedPaymentBtn').addEventListener('click', () => {
    const radio = document.querySelector(`input[name="paymentMethod"][value="${saved.method}"]`);
    if (radio) { radio.checked = true; togglePaymentFields(); }
    banner.classList.add('d-none');
    showToastSafe(`${label} selected — confirm the rest of your details below`, 'success');
  });
  document.getElementById('chooseNewPaymentBtn').addEventListener('click', () => {
    banner.classList.add('d-none');
  });
}

function togglePaymentFields() {
  const method = document.querySelector('input[name="paymentMethod"]:checked')?.value;
  const groups = {
    card: 'cardFields', banktransfer: 'bankFields', cod: 'codFields',
    paypal: 'paypalFields', applepay: 'applePayFields', googlepay: 'googlePayFields'
  };
  Object.entries(groups).forEach(([value, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('d-none', method !== value);
  });

  // Only require the fields belonging to the currently-selected method,
  // so hidden fields from other methods never block form submission.
  const requiredByMethod = {
    card: ['cardName'],
    paypal: ['paypalEmail']
  };
  ['cardName', 'paypalEmail'].forEach(name => {
    const field = document.querySelector(`[name="${name}"]`);
    if (field) field.required = (requiredByMethod[method] || []).includes(name);
  });

  // Reset any prior "confirmed" state when switching methods.
  // Card requires real Stripe tokenization (handled in placeOrder); bank transfer
  // and COD need no upfront confirmation since no payment credential is collected.
  KC.paymentConfirmed = (method === 'banktransfer' || method === 'cod');
  if (method === 'card' && typeof updateCardTokenStatus === 'function') updateCardTokenStatus('');
}

function initWalletConfirmButtons() {
  const paypalBtn = cloneToClearListeners('paypalConnectBtn');
  const appleBtn = cloneToClearListeners('applePayBtn');
  const googleBtn = cloneToClearListeners('googlePayBtn');

  if (paypalBtn) paypalBtn.addEventListener('click', () => {
    const email = document.querySelector('[name="paypalEmail"]')?.value.trim();
    const status = document.getElementById('paypalStatus');
    if (!email) { status.textContent = 'Enter your PayPal email first.'; status.classList.add('text-danger'); return; }
    status.classList.remove('text-danger');
    status.textContent = 'Connecting to PayPal…';
    setTimeout(() => {
      status.textContent = `Confirmed with PayPal (${email}). You can now place your order.`;
      status.classList.add('text-success');
      KC.paymentConfirmed = true;
      showToastSafe('PayPal payment confirmed', 'success');
    }, 900);
  });

  if (appleBtn) appleBtn.addEventListener('click', () => {
    const status = document.getElementById('applePayStatus');
    status.textContent = 'Verifying…';
    setTimeout(() => {
      status.textContent = 'Confirmed with Face ID. You can now place your order.';
      status.classList.add('text-success');
      KC.paymentConfirmed = true;
      showToastSafe('Apple Pay confirmed', 'success');
    }, 900);
  });

  if (googleBtn) googleBtn.addEventListener('click', () => {
    const status = document.getElementById('googlePayStatus');
    status.textContent = 'Verifying…';
    setTimeout(() => {
      status.textContent = 'Confirmed with Google Pay. You can now place your order.';
      status.classList.add('text-success');
      KC.paymentConfirmed = true;
      showToastSafe('Google Pay confirmed', 'success');
    }, 900);
  });
}
function cloneToClearListeners(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const fresh = el.cloneNode(true);
  el.parentNode.replaceChild(fresh, el);
  return fresh;
}

function renderCheckoutSummary() {
  const box = document.getElementById('checkoutSummary');
  if (!box) return;
  const items = KC.cart.map(item => {
    const p = KC.products.find(prod => prod.id === item.id);
    return p ? { ...p, qty: item.qty } : null;
  }).filter(Boolean);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const cfg = typeof getActiveStoreConfig === 'function' ? getActiveStoreConfig() : { vatRate: 7.5, deliveryFee: 4.99, freeDeliveryThreshold: 50 };
  const vat = subtotal * (cfg.vatRate / 100);
  const delivery = subtotal >= cfg.freeDeliveryThreshold ? 0 : cfg.deliveryFee;
  const total = subtotal + vat + delivery;

  box.innerHTML = `
    ${items.map(i => `
      <div class="d-flex justify-content-between small mb-2">
        <span>${i.name} × ${i.qty}</span>
        <span>$${(i.price * i.qty).toFixed(2)}</span>
      </div>`).join('')}
    <hr>
    <div class="d-flex justify-content-between small mb-1"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
    <div class="d-flex justify-content-between small mb-1"><span>VAT</span><span>$${vat.toFixed(2)}</span></div>
    <div class="d-flex justify-content-between small mb-2"><span>Delivery</span><span>${delivery === 0 ? 'Free' : '$' + delivery.toFixed(2)}</span></div>
    <hr>
    <div class="d-flex justify-content-between fw-bold fs-5"><span>Total</span><span>$${total.toFixed(2)}</span></div>
  `;
  box.dataset.total = total.toFixed(2);
}

async function placeOrder(e) {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const method = document.querySelector('input[name="paymentMethod"]:checked')?.value;

  if (method === 'card') {
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifying card…'; }
    const cardName = form.cardName?.value.trim();
    const cardZip = form.cardZip?.value.trim();
    const tokenized = typeof tokenizeCardWithStripe === 'function'
      ? await tokenizeCardWithStripe(cardName, cardZip)
      : false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Place Order'; }
    if (!tokenized) {
      showToastSafe('Please enter a valid card — see the error above the card field', 'warning');
      return;
    }
  }

  const walletMethods = ['paypal', 'applepay', 'googlepay'];
  if (walletMethods.includes(method) && !KC.paymentConfirmed) {
    const labels = { paypal: 'PayPal', applepay: 'Apple Pay', googlepay: 'Google Pay' };
    showToastSafe(`Please confirm payment with ${labels[method]} first`, 'warning');
    return;
  }

  const items = KC.cart.map(item => {
    const p = KC.products.find(prod => prod.id === item.id);
    return p ? { id: p.id, name: p.name, price: p.price, qty: item.qty, image: p.image } : null;
  }).filter(Boolean);

  const order = {
    id: 'ORD-' + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    items,
    total: parseFloat(document.getElementById('checkoutSummary').dataset.total || '0'),
    paymentMethod: method,
    stripePaymentMethodId: (method === 'card' && typeof lastPaymentMethodResult !== 'undefined' && lastPaymentMethodResult) ? lastPaymentMethodResult.id : null,
    shipping: {
      name: form.fullName.value,
      email: form.email.value,
      address: form.address.value,
      city: form.city.value,
      phone: form.phone.value
    },
    status: 'Processing'
  };

  const orders = JSON.parse(localStorage.getItem('kc_orders') || '[]');
  orders.push(order);
  localStorage.setItem('kc_orders', JSON.stringify(orders));

  // Attach to logged-in user if session exists, and remember payment method for next time
  const session = getSession();
  if (session) {
    const users = getUsers();
    const user = users.find(u => u.id === session.id);
    if (user) {
      user.orders = user.orders || [];
      user.orders.push(order.id);
      user.lastPaymentMethod = {
        method,
        cardBrand: (method === 'card' && lastPaymentMethodResult) ? lastPaymentMethodResult.card.brand : null,
        cardLast4: (method === 'card' && lastPaymentMethodResult) ? lastPaymentMethodResult.card.last4 : null
      };
      saveUsers(users);
    }
  }

  KC.cart = [];
  persist('kc_cart', KC.cart);
  localStorage.removeItem('kc_active_coupon');

  showConfirmation(order);
}

function showConfirmation(order) {
  document.getElementById('checkoutFormWrap').classList.add('d-none');
  const box = document.getElementById('orderConfirmation');
  box.classList.remove('d-none');
  box.innerHTML = `
    <div class="text-center py-4">
      <i class="bi bi-check-circle-fill text-success" style="font-size:3rem"></i>
      <h2 class="fs-4 fw-bold mt-3">Order placed successfully!</h2>
      <p class="text-muted">Order ID: <strong>${order.id}</strong></p>
      <p class="text-muted">A receipt has been saved to your order history.</p>
      <div class="d-flex gap-2 justify-content-center mt-3">
        <a href="#" onclick="navigateTo('profile'); return false;" class="btn btn-primary">View Order History</a>
        <a href="#" onclick="navigateTo('products'); return false;" class="btn btn-outline-secondary">Continue Shopping</a>
      </div>
    </div>
  `;
}


