import { supabase, dbService, authService, appState, t, translations } from './config.js';

// ==================== ENHANCED RECEIPT PRINTING ====================
function generateReceipt(sale, items) {
  const date = new Date(sale.created_at);
  const receipt = `
╔════════════════════════════════════════╗
║     WATERMELON SODA - RECEIPT         ║
║        🍉 Fizzy • Fruity • Fun! 🍉    ║
╚════════════════════════════════════════╝

Receipt #: ${sale.receipt_number}
Date: ${date.toLocaleDateString()}
Time: ${date.toLocaleTimeString()}
Cashier: ${sale.staff_name}
Outlet: ${sale.outlet_name}

────────────────────────────────────────
ITEMS
────────────────────────────────────────`;

  let total = 0;
  items.forEach(item => {
    const subtotal = item.quantity * item.unit_price;
    total += subtotal;
    receipt += `
${item.product_name.padEnd(25)} x${item.quantity}
  RM${item.unit_price.toFixed(2)} × ${item.quantity} = RM${subtotal.toFixed(2)}`;
  });

  receipt += `
────────────────────────────────────────
TOTAL: RM${total.toFixed(2)}
Payment: ${sale.payment_method.toUpperCase()}
────────────────────────────────────────
Thank you for your purchase!
See you again soon! 🍉

Powered by Watermelon Soda POS v2.0
  `;
  return receipt;
}

async function printReceipt(saleId) {
  try {
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .single();
    
    if (saleError) throw saleError;

    const { data: items, error: itemsError } = await supabase
      .from('sale_items')
      .select('product_id, quantity, unit_price, products(name)')
      .eq('sale_id', saleId);
    
    if (itemsError) throw itemsError;

    const receipt = generateReceipt(sale, items.map(i => ({
      ...i,
      product_name: i.products.name
    })));

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<pre>${receipt}</pre>`);
    printWindow.print();
    
    // Log audit trail
    await dbService.logAuditTrail('PRINT_RECEIPT', { saleId }, appState.user.id);
  } catch (error) {
    console.error('Print error:', error);
    alert('Failed to print receipt');
  }
}

// ==================== STAFF MANAGEMENT ====================
async function showStaffManagement() {
  const { data: staff } = await supabase
    .from('staff')
    .select('*')
    .order('name');

  let html = `
    <div class="panel">
      <h3>${t('staff')}</h3>
      <button id="addStaffBtn" class="btn">${t('addBtn')} Staff</button>
      <table class="data-table">
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Outlet</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>`;
  
  staff.forEach(s => {
    html += `
      <tr>
        <td>${s.name}</td>
        <td>${s.email}</td>
        <td>${s.role}</td>
        <td>${s.outlet_id || 'N/A'}</td>
        <td><span class="badge ${s.active ? 'active' : 'inactive'}">${s.active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button onclick="editStaff('${s.id}')" class="btn-small">Edit</button>
          <button onclick="toggleStaffStatus('${s.id}', ${!s.active})" class="btn-small">${s.active ? 'Deactivate' : 'Activate'}</button>
        </td>
      </tr>`;
  });
  
  html += `</table></div>`;
  document.getElementById('main').innerHTML = html;
  
  document.getElementById('addStaffBtn').onclick = showAddStaffForm;
}

async function showAddStaffForm() {
  const { data: outlets } = await supabase.from('outlets').select('*');
  
  const html = `
    <div class="form-card">
      <h3>Add Staff Member</h3>
      <form id="staffForm">
        <div class="field">
          <label>Name</label>
          <input type="text" id="staffName" required>
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="staffEmail" required>
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" id="staffPassword" required>
        </div>
        <div class="field">
          <label>Role</label>
          <select id="staffRole">
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div class="field">
          <label>Outlet</label>
          <select id="staffOutlet">
            <option value="">Select Outlet</option>
            ${outlets.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>PIN (4 digits)</label>
          <input type="password" id="staffPin" maxlength="4" placeholder="0000">
        </div>
        <button type="submit" class="btn">Save Staff</button>
      </form>
    </div>`;
  
  document.getElementById('main').innerHTML = html;
  
  document.getElementById('staffForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: document.getElementById('staffEmail').value,
        password: document.getElementById('staffPassword').value,
        email_confirm: true
      });

      if (authError) throw authError;

      const { error: dbError } = await supabase.from('staff').insert([{
        id: authData.user.id,
        name: document.getElementById('staffName').value,
        email: document.getElementById('staffEmail').value,
        role: document.getElementById('staffRole').value,
        outlet_id: document.getElementById('staffOutlet').value || null,
        pin: document.getElementById('staffPin').value
      }]);

      if (dbError) throw dbError;

      await dbService.logAuditTrail('ADD_STAFF', {
        name: document.getElementById('staffName').value,
        email: document.getElementById('staffEmail').value
      }, appState.user.id);

      alert('Staff member added successfully');
      showStaffManagement();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to add staff member');
    }
  };
}

async function toggleStaffStatus(staffId, newStatus) {
  try {
    await supabase.from('staff').update({ active: newStatus }).eq('id', staffId);
    await dbService.logAuditTrail('TOGGLE_STAFF_STATUS', { staffId, newStatus }, appState.user.id);
    showStaffManagement();
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to update staff status');
  }
}

// ==================== INVENTORY TRACKING ====================
async function showInventory() {
  const { data: inventory } = await supabase
    .from('inventory')
    .select(`
      *,
      products(name, sku, price),
      outlets(name)
    `)
    .order('products(name)');

  let html = `
    <div class="panel">
      <h3>${t('inventory')}</h3>
      <table class="data-table">
        <tr>
          <th>Product</th>
          <th>SKU</th>
          <th>Outlet</th>
          <th>Quantity</th>
          <th>Reorder Level</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>`;
  
  inventory.forEach(item => {
    const status = item.quantity <= item.reorder_level ? 'LOW STOCK' : 'OK';
    const statusClass = item.quantity <= item.reorder_level ? 'warning' : 'success';
    
    html += `
      <tr>
        <td>${item.products.name}</td>
        <td>${item.products.sku}</td>
        <td>${item.outlets.name}</td>
        <td>${item.quantity}</td>
        <td>${item.reorder_level}</td>
        <td><span class="badge ${statusClass}">${status}</span></td>
        <td>
          <button onclick="updateInventory('${item.id}', 'add')" class="btn-small">+</button>
          <button onclick="updateInventory('${item.id}', 'minus')" class="btn-small">-</button>
        </td>
      </tr>`;
  });
  
  html += `</table></div>`;
  document.getElementById('main').innerHTML = html;
}

async function updateInventory(inventoryId, action) {
  const quantity = prompt(`Enter quantity to ${action === 'add' ? 'add' : 'subtract'}:`);
  if (!quantity) return;

  try {
    const { data: current } = await supabase.from('inventory').select('quantity').eq('id', inventoryId).single();
    const newQuantity = action === 'add' ? current.quantity + parseInt(quantity) : current.quantity - parseInt(quantity);

    await supabase.from('inventory').update({ quantity: newQuantity }).eq('id', inventoryId);
    await dbService.logAuditTrail('UPDATE_INVENTORY', { inventoryId, action, quantity }, appState.user.id);
    showInventory();
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to update inventory');
  }
}

// ==================== SHIFT MANAGEMENT ====================
async function startShift() {
  try {
    const shift = await dbService.startShift(appState.user.id, appState.user.outlet_id);
    appState.currentShift = shift.id;
    localStorage.setItem('current_shift', shift.id);
    alert('Shift started');
    await dbService.logAuditTrail('START_SHIFT', { shiftId: shift.id }, appState.user.id);
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to start shift');
  }
}

async function endShift() {
  const cashCount = prompt('Enter cash count:');
  if (!cashCount) return;

  try {
    await dbService.endShift(appState.currentShift, parseFloat(cashCount));
    appState.currentShift = null;
    localStorage.removeItem('current_shift');
    alert('Shift ended');
    await dbService.logAuditTrail('END_SHIFT', { cashCount }, appState.user.id);
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to end shift');
  }
}

// ==================== REFUND & VOID HANDLING ====================
async function refundTransaction(saleId) {
  const amount = prompt('Enter refund amount:');
  const reason = prompt('Reason for refund:');
  
  if (!amount || !reason) return;

  try {
    await dbService.processRefund(saleId, parseFloat(amount), reason);
    await supabase.from('sales').update({ status: 'refunded' }).eq('id', saleId);
    await dbService.logAuditTrail('REFUND_TRANSACTION', { saleId, amount, reason }, appState.user.id);
    alert('Refund processed');
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to process refund');
  }
}

async function voidTransaction(saleId) {
  const reason = prompt('Reason for void:');
  if (!reason) return;

  try {
    await dbService.voidTransaction(saleId, reason);
    await dbService.logAuditTrail('VOID_TRANSACTION', { saleId, reason }, appState.user.id);
    alert('Transaction voided');
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to void transaction');
  }
}

// ==================== DETAILED SALES REPORTS & ANALYTICS ====================
async function showSalesReport() {
  const startDate = prompt('Start date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  const endDate = prompt('End date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);

  if (!startDate || !endDate) return;

  try {
    const sales = await dbService.getSalesReport(startDate, endDate);
    
    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const avgTransaction = totalSales / sales.length;
    const totalTransactions = sales.length;
    
    const paymentMethods = {};
    sales.forEach(s => {
      paymentMethods[s.payment_method] = (paymentMethods[s.payment_method] || 0) + s.total;
    });

    let html = `
      <div class="panel">
        <h3>${t('reports')}</h3>
        <div class="metrics">
          <div class="metric">
            <small>Total Sales</small>
            <strong>RM${totalSales.toFixed(2)}</strong>
          </div>
          <div class="metric">
            <small>Transactions</small>
            <strong>${totalTransactions}</strong>
          </div>
          <div class="metric">
            <small>Average Transaction</small>
            <strong>RM${avgTransaction.toFixed(2)}</strong>
          </div>
        </div>
        
        <h4>Payment Methods</h4>
        <table class="data-table">
          <tr>
            <th>Method</th>
            <th>Amount</th>
            <th>%</th>
          </tr>`;

    for (const [method, amount] of Object.entries(paymentMethods)) {
      const percentage = ((amount / totalSales) * 100).toFixed(1);
      html += `<tr><td>${method}</td><td>RM${amount.toFixed(2)}</td><td>${percentage}%</td></tr>`;
    }

    html += `</table></div>`;
    document.getElementById('main').innerHTML = html;
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to generate report');
  }
}

// ==================== LANGUAGE SWITCHING ====================
function switchLanguage(lang) {
  appState.language = lang;
  localStorage.setItem('pos_language', lang);
  location.reload();
}

// ==================== CLOUD DATA SYNC ====================
async function syncData() {
  try {
    const deviceId = localStorage.getItem('device_id') || crypto.randomUUID();
    localStorage.setItem('device_id', deviceId);

    // Sync local changes to server
    const localSales = JSON.parse(localStorage.getItem('local_sales') || '[]');
    
    for (const sale of localSales) {
      await supabase.from('sales').insert([sale]);
      await supabase.from('sync_log').insert([{
        device_id: deviceId,
        action: 'SYNC_UPLOAD',
        table_name: 'sales',
        record_id: sale.id,
        status: 'success'
      }]);
    }

    localStorage.setItem('local_sales', '[]');
    console.log('Data synced successfully');
  } catch (error) {
    console.error('Sync error:', error);
  }
}

// Sync every 30 seconds
setInterval(syncData, 30000);

export {
  printReceipt,
  showStaffManagement,
  showAddStaffForm,
  showInventory,
  updateInventory,
  startShift,
  endShift,
  refundTransaction,
  voidTransaction,
  showSalesReport,
  switchLanguage,
  syncData
};