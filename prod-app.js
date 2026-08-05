// Production-ready Watermelon Soda POS Application
import { supabase, dbService, authService, appState, t, translations } from './config.js';
import { 
  printReceipt, showStaffManagement, showInventory, startShift, endShift,
  refundTransaction, voidTransaction, showSalesReport, switchLanguage, syncData
} from './features.js';
import {
  SecurityManager, AccessControl, PCICompliance, AuditLogger, SessionSecurity, DataProtection
} from './security.js';

const app = document.getElementById('app');
const securityManager = new SecurityManager();

// ==================== MAIN APPLICATION ====================
async function initializeApp() {
  const user = await authService.getCurrentUser();
  
  if (!user) {
    showLoginScreen();
  } else {
    appState.isLoggedIn = true;
    appState.user = user;
    SessionSecurity.initializeSessionTimeout();
    loadMainInterface();
  }
}

function showLoginScreen() {
  app.innerHTML = `
    <div class="shell">
      <div class="login">
        <div class="card brand">
          <img src="logo.jpg" alt="Watermelon Soda">
          <h1>${t('login')}</h1>
          <p>🍉 Fizzy • Fruity • Fun! 🍉</p>
          <div class="language-selector">
            <button onclick="switchLanguage('en')" class="lang-btn ${appState.language === 'en' ? 'active' : ''}">English</button>
            <button onclick="switchLanguage('ms')" class="lang-btn ${appState.language === 'ms' ? 'active' : ''}">Bahasa Malaysia</button>
          </div>
        </div>
        
        <div class="card form">
          <div id="loginTabs" class="tabs">
            <button id="employeeTab" class="tab active">${t('employee')}</button>
            <button id="ownerTab" class="tab">${t('owner')}</button>
          </div>
          <div id="loginForm"></div>
        </div>
      </div>
    </div>`;
  
  document.getElementById('employeeTab').onclick = () => showEmployeeLogin();
  document.getElementById('ownerTab').onclick = () => showOwnerLogin();
  
  showEmployeeLogin();
}

function showEmployeeLogin() {
  const form = document.getElementById('loginForm');
  form.innerHTML = `
    <h2 class="title">${t('login')}</h2>
    <div class="field">
      <label>${t('username')}</label>
      <input id="empEmail" type="email" placeholder="email@example.com">
    </div>
    <div class="field">
      <label>${t('password')}</label>
      <input id="empPassword" type="password" placeholder="Password">
    </div>
    <button class="btn" id="empLoginBtn">${t('login')}</button>
    <div class="note">Demo: employee@test.com / password123</div>`;
  
  document.getElementById('empLoginBtn').onclick = async () => {
    try {
      const email = document.getElementById('empEmail').value;
      const password = document.getElementById('empPassword').value;
      
      if (!email || !password) {
        alert('Please enter email and password');
        return;
      }

      const user = await authService.login(email, password);
      appState.user = user;
      
      // Get staff details
      const { data: staffData } = await supabase
        .from('staff')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();
      
      appState.user = { ...user, ...staffData };
      
      await AuditLogger.logAction(user.id, 'LOGIN', { method: 'email_password' }, getClientIpAddress());
      SessionSecurity.initializeSessionTimeout();
      loadMainInterface();
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + error.message);
    }
  };
}

function showOwnerLogin() {
  const form = document.getElementById('loginForm');
  form.innerHTML = `
    <h2 class="title">${t('login')}</h2>
    <div class="field">
      <label>${t('username')}</label>
      <input id="ownerEmail" type="email" placeholder="owner@watermelonsoda.com">
    </div>
    <div class="field">
      <label>${t('password')}</label>
      <input id="ownerPassword" type="password" placeholder="Password">
    </div>
    <button class="btn" id="ownerLoginBtn">${t('login')}</button>
    <div class="note">Demo: owner@watermelonsoda.com / Melon2026!</div>`;
  
  document.getElementById('ownerLoginBtn').onclick = async () => {
    try {
      const email = document.getElementById('ownerEmail').value;
      const password = document.getElementById('ownerPassword').value;
      
      if (!email || !password) {
        alert('Please enter email and password');
        return;
      }

      const user = await authService.login(email, password);
      appState.user = user;
      
      const { data: staffData } = await supabase
        .from('staff')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();
      
      appState.user = { ...user, ...staffData };
      
      await AuditLogger.logAction(user.id, 'LOGIN', { method: 'owner', role: 'owner' }, getClientIpAddress());
      SessionSecurity.initializeSessionTimeout();
      loadMainInterface();
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + error.message);
    }
  };
}

async function loadMainInterface() {
  try {
    AccessControl.enforcePermission(appState.user.role, 'VIEW_SALES');
    
    if (appState.user.role === 'owner') {
      loadOwnerDashboard();
    } else {
      loadPOSInterface();
    }
  } catch (error) {
    alert('Access Denied: ' + error.message);
    await authService.logout();
    showLoginScreen();
  }
}

async function loadPOSInterface() {
  const products = await dbService.getProducts();
  
  app.innerHTML = `
    <div class="shell">
      <div class="top">
        <div class="left">
          <img src="logo.jpg" alt="Watermelon Soda">
          <div>
            <h2 class="title">Watermelon Soda POS</h2>
            <b>${appState.user.outlet_id || 'Main Outlet'}</b>
            <small>Shift: ${appState.currentShift ? 'Active' : 'Inactive'}</small>
          </div>
        </div>
        <div class="header-right">
          <div>
            <select id="langSelect" onchange="switchLanguage(this.value)">
              <option value="en" ${appState.language === 'en' ? 'selected' : ''}>English</option>
              <option value="ms" ${appState.language === 'ms' ? 'selected' : ''}>Bahasa Malaysia</option>
            </select>
            ${appState.user.name} (${appState.user.role})<br>
            <button id="startShiftBtn" class="btn-small" style="margin-right: 5px;">${t('startShift')}</button>
            <button id="endShiftBtn" class="btn-small">${t('endShift')}</button>
            <button id="logoutBtn" class="btn-small" style="margin-left: 5px;">${t('logout')}</button>
          </div>
        </div>
      </div>

      <div class="grid">
        <div class="card panel">
          <h3 class="title">${t('products')}</h3>
          <div class="products">
            ${products.map(p => `
              <button class="product" data-id="${p.id}">
                <b>${p.name}</b>
                <span>RM${p.price.toFixed(2)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="card panel">
          <h3 class="title">${t('currentOrder')}</h3>
          <div id="cartList"></div>
          <div class="total">
            <span>${t('total')}</span>
            <span id="totalAmount">RM0.00</span>
          </div>
          <div class="pays">
            <button class="pay active" data-pay="cash">${t('cash')}</button>
            <button class="pay" data-pay="card">${t('card')}</button>
            <button class="pay" data-pay="qr">QR</button>
          </div>
          <button class="btn" id="completeSaleBtn" style="margin-top: 12px;">${t('completeSale')}</button>
          <button class="btn-secondary" id="printReceiptBtn">🖨️ ${t('print')}</button>
        </div>
      </div>

      <div class="nav-buttons">
        ${AccessControl.canPerform(appState.user.role, 'VIEW_INVENTORY') ? '<button id="inventoryBtn" class="nav-btn">📦 ' + t('inventory') + '</button>' : ''}
        ${AccessControl.canPerform(appState.user.role, 'MANAGE_STAFF') ? '<button id="staffBtn" class="nav-btn">👥 ' + t('staff') + '</button>' : ''}
        ${AccessControl.canPerform(appState.user.role, 'VIEW_ANALYTICS') ? '<button id="reportsBtn" class="nav-btn">📊 ' + t('reports') + '</button>' : ''}
      </div>
    </div>`;

  // Event listeners
  document.querySelectorAll('.product').forEach(btn => {
    btn.onclick = () => addToCart(btn.dataset.id, products.find(p => p.id === btn.dataset.id));
  });

  document.querySelectorAll('.pay').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.pay').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.payment = btn.dataset.pay;
    };
  });

  document.getElementById('completeSaleBtn').onclick = completeSale;
  document.getElementById('printReceiptBtn').onclick = printLastReceipt;
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('startShiftBtn').onclick = () => startShift();
  document.getElementById('endShiftBtn').onclick = () => endShift();

  if (document.getElementById('inventoryBtn')) {
    document.getElementById('inventoryBtn').onclick = showInventory;
  }
  if (document.getElementById('staffBtn')) {
    document.getElementById('staffBtn').onclick = showStaffManagement;
  }
  if (document.getElementById('reportsBtn')) {
    document.getElementById('reportsBtn').onclick = showSalesReport;
  }

  updateCart();
}

function addToCart(productId, product) {
  appState.cart[productId] = (appState.cart[productId] || 0) + 1;
  updateCart();
  AuditLogger.logAction(appState.user.id, 'ADD_TO_CART', { productId, quantity: appState.cart[productId] }, getClientIpAddress());
}

function updateCart() {
  const cartList = document.getElementById('cartList');
  const items = Object.keys(appState.cart).filter(id => appState.cart[id] > 0);

  if (items.length === 0) {
    cartList.innerHTML = `<div class="note">${t('addItem')}</div>`;
    document.getElementById('totalAmount').textContent = 'RM0.00';
    return;
  }

  const products = JSON.parse(localStorage.getItem('products') || '[]');
  let html = '';
  let total = 0;

  items.forEach(id => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const subtotal = product.price * appState.cart[id];
    total += subtotal;

    html += `
      <div class="row">
        <div>
          <b>${product.name}</b><br>
          <small>RM${product.price.toFixed(2)}</small>
        </div>
        <div class="qty">
          <button onclick="decreaseQuantity('${id}')" class="btn-small">−</button>
          ${appState.cart[id]}
          <button onclick="increaseQuantity('${id}')" class="btn-small">+</button>
        </div>
        <b>RM${subtotal.toFixed(2)}</b>
      </div>`;
  });

  cartList.innerHTML = html;
  document.getElementById('totalAmount').textContent = `RM${total.toFixed(2)}`;
}

function increaseQuantity(productId) {
  appState.cart[productId]++;
  updateCart();
}

function decreaseQuantity(productId) {
  if (appState.cart[productId] > 1) {
    appState.cart[productId]--;
  } else {
    delete appState.cart[productId];
  }
  updateCart();
}

async function completeSale() {
  const total = Object.keys(appState.cart).reduce((sum, id) => {
    const products = JSON.parse(localStorage.getItem('products') || '[]');
    const product = products.find(p => p.id === id);
    return sum + (product.price * appState.cart[id]);
  }, 0);

  if (total === 0) {
    alert('Please add items to cart');
    return;
  }

  try {
    // Validate payment for card payments
    if (appState.payment === 'card') {
      const validation = PCICompliance.validatePaymentData({
        amount: total,
        method: 'card'
      });
      
      if (!validation.valid) {
        alert('Payment validation failed: ' + validation.errors.join(', '));
        return;
      }
    }

    const sale = {
      staff_id: appState.user.id,
      outlet_id: appState.user.outlet_id,
      shift_id: appState.currentShift,
      total: total,
      payment_method: appState.payment,
      receipt_number: `REC-${Date.now()}`,
      status: 'completed'
    };

    const { data: savedSale } = await dbService.saveSale(sale);
    
    // Log audit trail
    await AuditLogger.logAction(appState.user.id, 'COMPLETE_SALE', {
      saleId: savedSale[0].id,
      amount: total,
      paymentMethod: appState.payment
    }, getClientIpAddress());

    alert('Sale completed! Receipt #' + sale.receipt_number);
    appState.cart = {};
    updateCart();
    
    // Auto-print receipt
    await printReceipt(savedSale[0].id);
  } catch (error) {
    console.error('Sale error:', error);
    alert('Failed to complete sale');
  }
}

async function printLastReceipt() {
  try {
    AccessControl.enforcePermission(appState.user.role, 'PRINT_RECEIPT');
    const { data: lastSale } = await supabase
      .from('sales')
      .select('*')
      .eq('staff_id', appState.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (lastSale) {
      await printReceipt(lastSale.id);
    }
  } catch (error) {
    console.error('Print error:', error);
    alert('Failed to print receipt');
  }
}

async function loadOwnerDashboard() {
  app.innerHTML = `
    <div class="shell">
      <div class="top">
        <div class="left">
          <img src="logo.jpg" alt="Watermelon Soda">
          <h2 class="title">Watermelon Soda HQ</h2>
        </div>
        <div>
          <select id="langSelect" onchange="switchLanguage(this.value)">
            <option value="en" ${appState.language === 'en' ? 'selected' : ''}>English</option>
            <option value="ms" ${appState.language === 'ms' ? 'selected' : ''}>Bahasa Malaysia</option>
          </select>
          ${appState.user.name}<br>
          <button id="logoutBtn" class="btn-small">${t('logout')}</button>
        </div>
      </div>

      <div id="main" class="dashboard-content">
        <div class="metrics">
          <div class="card metric">
            <small>Today's Sales</small>
            <strong id="todaySales">RM0.00</strong>
          </div>
          <div class="card metric">
            <small>Transactions</small>
            <strong id="transactionCount">0</strong>
          </div>
          <div class="card metric">
            <small>Active Shifts</small>
            <strong id="activeShifts">0</strong>
          </div>
        </div>

        <div class="nav-buttons" style="margin: 20px 0;">
          <button id="staffMgtBtn" class="nav-btn">👥 ${t('staff')}</button>
          <button id="inventoryBtn" class="nav-btn">📦 ${t('inventory')}</button>
          <button id="reportsBtn" class="nav-btn">📊 ${t('reports')}</button>
          <button id="auditBtn" class="nav-btn">🔐 Audit Log</button>
          <button id="backupBtn" class="nav-btn">💾 Backup</button>
        </div>
      </div>
    </div>`;

  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('staffMgtBtn').onclick = showStaffManagement;
  document.getElementById('inventoryBtn').onclick = showInventory;
  document.getElementById('reportsBtn').onclick = showSalesReport;
  document.getElementById('auditBtn').onclick = showAuditLog;
  document.getElementById('backupBtn').onclick = () => DataProtection.backupEncryptedData();

  loadDashboardMetrics();
}

async function loadDashboardMetrics() {
  const today = new Date().toISOString().split('T')[0];
  const sales = await dbService.getSalesReport(today + 'T00:00:00Z', today + 'T23:59:59Z');
  
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  
  document.getElementById('todaySales').textContent = `RM${totalSales.toFixed(2)}`;
  document.getElementById('transactionCount').textContent = sales.length;
}

async function showAuditLog() {
  try {
    AccessControl.enforcePermission(appState.user.role, 'VIEW_AUDIT_LOG');
    const logs = await AuditLogger.getAuditLog();
    
    let html = `<div class="panel"><h3>Audit Log</h3><table class="data-table">
      <tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th></tr>`;
    
    logs.forEach(log => {
      html += `<tr>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
        <td>${log.user_id}</td>
        <td>${log.action}</td>
        <td>${log.details || 'N/A'}</td>
      </tr>`;
    });
    
    html += `</table></div>`;
    document.getElementById('main').innerHTML = html;
  } catch (error) {
    alert('Access Denied: ' + error.message);
  }
}

async function logout() {
  await authService.logout();
  appState.cart = {};
  showLoginScreen();
}

function getClientIpAddress() {
  return 'unknown'; // In production, use a backend endpoint to get real IP
}

// Initialize on load
window.addEventListener('load', initializeApp);

// Global functions for HTML onclick handlers
window.switchLanguage = switchLanguage;
window.increaseQuantity = increaseQuantity;
window.decreaseQuantity = decreaseQuantity;
window.startShift = startShift;
window.endShift = endShift;
window.showInventory = showInventory;
window.showStaffManagement = showStaffManagement;
window.showSalesReport = showSalesReport;
