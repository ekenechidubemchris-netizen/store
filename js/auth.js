/* ===================================================
   KENECART - auth.js
   Customer authentication: register, login, session,
   forgot password (demo), profile edit.
   All data simulated via localStorage.
   =================================================== */

const AUTH_USERS_KEY = 'kc_users';
const AUTH_SESSION_KEY = 'kc_session';

function getUsers() {
  return JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || '[]');
}
function saveUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}
function getSession() {
  return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
}
function setSession(user) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ id: user.id, email: user.email, name: user.name }));
}
function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}
function requireAuth(redirectTo = 'customer-login') {
  if (!getSession()) navigateTo(redirectTo);
}

/* Simple demo hash so we don't store plaintext passwords in localStorage */
function demoHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + Math.abs(hash);
}

function generateId(prefix = 'CUS') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/* ---------- Seed demo customer accounts ---------- */
function ensureCustomersSeeded() {
  const users = getUsers();
  const demoEmails = ['jane.demo@kenecart.com', 'michael.demo@kenecart.com'];
  const alreadySeeded = demoEmails.every(e => users.some(u => u.email === e));
  if (alreadySeeded) return;

  const demoCustomers = [
    {
      id: 'CUS-DEMO01',
      name: 'Jane Demo',
      email: 'jane.demo@kenecart.com',
      phone: '+1 555 0201',
      passwordHash: demoHash('shopper123'),
      avatar: 'https://ui-avatars.com/api/?name=Jane+Demo&background=2563EB&color=fff',
      createdAt: new Date().toISOString(),
      addresses: [], paymentMethods: [], orders: [], status: 'Active'
    },
    {
      id: 'CUS-DEMO02',
      name: 'Michael Demo',
      email: 'michael.demo@kenecart.com',
      phone: '+1 555 0202',
      passwordHash: demoHash('shopper456'),
      avatar: 'https://ui-avatars.com/api/?name=Michael+Demo&background=2563EB&color=fff',
      createdAt: new Date().toISOString(),
      addresses: [], paymentMethods: [], orders: [], status: 'Active'
    }
  ];

  demoEmails.forEach((email, i) => {
    if (!users.some(u => u.email === email)) users.push(demoCustomers[i]);
  });
  saveUsers(users);
}

/* ---------- Register ---------- */
function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.fullName.value.trim();
  const email = form.email.value.trim().toLowerCase();
  const phone = form.phone.value.trim();
  const password = form.password.value;
  const confirm = form.confirmPassword.value;
  const errorBox = document.getElementById('registerError');
  errorBox.classList.add('d-none');

  if (!name || !email || !password) {
    return showFormError(errorBox, 'Please fill in all required fields.');
  }
  if (password.length < 6) {
    return showFormError(errorBox, 'Password must be at least 6 characters.');
  }
  if (password !== confirm) {
    return showFormError(errorBox, 'Passwords do not match.');
  }
  const users = getUsers();
  if (users.some(u => u.email === email)) {
    return showFormError(errorBox, 'An account with this email already exists.');
  }

  const newUser = {
    id: generateId(),
    name, email, phone,
    passwordHash: demoHash(password),
    avatar: 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2563EB&color=fff',
    createdAt: new Date().toISOString(),
    addresses: [],
    paymentMethods: [],
    orders: []
  };
  users.push(newUser);
  saveUsers(users);
  setSession(newUser);
  showToastSafe('Account created! Welcome to KeneCart.', 'success');
  const redirectTo = sessionStorage.getItem('kc_redirect_after_login');
  sessionStorage.removeItem('kc_redirect_after_login');
  setTimeout(() => navigateTo(redirectTo || 'home'), 700);
}

/* ---------- Login ---------- */
function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim().toLowerCase();
  const password = form.password.value;
  const errorBox = document.getElementById('loginError');
  errorBox.classList.add('d-none');

  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (!user || user.passwordHash !== demoHash(password)) {
    return showFormError(errorBox, 'Invalid email or password.');
  }
  setSession(user);
  showToastSafe(`Welcome back, ${user.name.split(' ')[0]}!`, 'success');
  const redirectTo = sessionStorage.getItem('kc_redirect_after_login');
  sessionStorage.removeItem('kc_redirect_after_login');
  setTimeout(() => navigateTo(redirectTo || 'home'), 500);
}

/* ---------- Forgot password (demo: sets a temp password) ---------- */
function handleForgotPassword(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim().toLowerCase();
  const box = document.getElementById('forgotResult');
  const users = getUsers();
  const user = users.find(u => u.email === email);

  if (!user) {
    box.className = 'alert alert-danger mt-3';
    box.textContent = 'No account found with that email.';
    box.classList.remove('d-none');
    return;
  }
  const tempPassword = Math.random().toString(36).slice(-8);
  user.passwordHash = demoHash(tempPassword);
  saveUsers(users);
  box.className = 'alert alert-success mt-3';
  box.innerHTML = `Demo mode: your temporary password is <strong>${tempPassword}</strong>. Use it to log in, then update it from your profile.`;
  box.classList.remove('d-none');
}

/* ---------- Logout ---------- */
function logout() {
  clearSession();
  navigateTo('home');
}

/* ---------- Helpers ---------- */
function showFormError(el, msg) {
  el.textContent = msg;
  el.classList.remove('d-none');
}
/* showToastSafe is defined once in app.js (see below) and shared globally */

