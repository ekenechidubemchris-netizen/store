/* ===================================================
   KENECART - stripe-integration.js
   Real integration with Stripe.js (loaded from
   https://js.stripe.com/v3/ in index.html).

   IMPORTANT — what is and isn't real here:
   - Loading Stripe.js, mounting the Card Element, and
     calling stripe.createPaymentMethod() are 100% real
     calls to Stripe's live test-mode API. Card validation,
     the test decline/insufficient-funds/success behavior,
     and the returned PaymentMethod ID (pm_...) are genuine
     Stripe responses — not simulated in this file.
   - What ISN'T possible without a backend: actually
     capturing/charging that payment method. Stripe requires
     a secret key (sk_test_...) to create and confirm a
     PaymentIntent, and secret keys must never be exposed in
     browser code. This is a static, backend-less site, so
     that final step can't be completed here. See the
     server-example/ folder for a ready-to-deploy snippet
     that completes the real charge once you have a backend.

   TO USE YOUR OWN STRIPE ACCOUNT:
   Replace STRIPE_PUBLISHABLE_KEY below with your own test
   publishable key from https://dashboard.stripe.com/test/apikeys
   (free account, no business verification needed for test mode).
   The key currently set is Stripe's own public documentation
   demo key — it works for trying this out, but for anything
   beyond casual testing you should use your own.
   =================================================== */

const STRIPE_PUBLISHABLE_KEY = 'pk_test_TYooMQauvdEDq54NiTphI7jx'; // Stripe's official demo key — replace with your own

let stripeInstance = null;
let stripeElements = null;
let stripeCardElement = null;
let lastPaymentMethodResult = null; // { id: 'pm_...' } on success, once tokenized

function initStripeElements() {
  if (typeof Stripe === 'undefined') {
    console.warn('Stripe.js failed to load (no internet access, or js.stripe.com blocked). Card payment will fall back to basic validation.');
    return;
  }
  const mountPoint = document.getElementById('stripeCardElement');
  if (!mountPoint) return; // not on checkout page

  if (!stripeInstance) stripeInstance = Stripe(STRIPE_PUBLISHABLE_KEY);
  stripeElements = stripeInstance.elements();

  const style = {
    base: {
      fontFamily: 'Inter, sans-serif',
      fontSize: '15px',
      color: getComputedStyle(document.documentElement).getPropertyValue('--kc-text').trim() || '#1E293B',
      '::placeholder': { color: '#94A3B8' }
    },
    invalid: { color: '#DC2626' }
  };

  stripeCardElement = stripeElements.create('card', { style, hidePostalCode: true });
  stripeCardElement.mount('#stripeCardElement');

  const errorBox = document.getElementById('stripeCardErrors');
  stripeCardElement.on('change', (event) => {
    errorBox.textContent = event.error ? event.error.message : '';
    lastPaymentMethodResult = null; // any edit invalidates a previous successful tokenization
    updateCardTokenStatus('');
  });
}

function updateCardTokenStatus(message, isError = false) {
  const box = document.getElementById('cardTokenStatus');
  if (!box) return;
  if (!message) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="small ${isError ? 'text-danger' : 'text-success'}"><i class="bi ${isError ? 'bi-x-circle' : 'bi-check-circle'}"></i> ${escapeHTML(message)}</div>`;
}

/**
 * Tokenizes the card currently entered into the Stripe Card Element.
 * This is a real network call to Stripe's API (test mode).
 * Returns true if a valid PaymentMethod was created, false otherwise.
 */
async function tokenizeCardWithStripe(billingName, billingZip) {
  if (!stripeInstance || !stripeCardElement) {
    // Stripe.js unavailable (e.g. no internet) — can't do real tokenization
    updateCardTokenStatus('Stripe could not be reached to validate this card (check your internet connection).', true);
    return false;
  }

  updateCardTokenStatus('Validating card with Stripe…');
  const { paymentMethod, error } = await stripeInstance.createPaymentMethod({
    type: 'card',
    card: stripeCardElement,
    billing_details: {
      name: billingName || undefined,
      address: billingZip ? { postal_code: billingZip } : undefined
    }
  });

  if (error) {
    updateCardTokenStatus(error.message, true);
    lastPaymentMethodResult = null;
    return false;
  }

  lastPaymentMethodResult = paymentMethod;
  updateCardTokenStatus(`Card verified by Stripe — token ${paymentMethod.id} (${paymentMethod.card.brand.toUpperCase()} •••• ${paymentMethod.card.last4}).`);
  showToastSafe('Card verified by Stripe', 'success');
  return true;
}

// Re-mount the Card Element fresh every time checkout is opened, since the
// underlying #stripeCardElement div is recreated whenever the page re-renders.
document.addEventListener('DOMContentLoaded', () => {
  const originalNavigateTo = window.navigateTo;
  window.navigateTo = function (page, params) {
    originalNavigateTo(page, params);
    if (page === 'checkout') {
      lastPaymentMethodResult = null;
      setTimeout(initStripeElements, 0); // after checkout markup is visible in the DOM
    }
  };
});
