// Supabase Configuration
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://jgyjiazhpbuwhblgjvdb.supabase.co'; // 
const SUPABASE_KEY = 'sb_publishable_OgokxparfvlBRYpC_mod4g_656YldMT'; // 

// Employee demo data
const DEMO_USERS = {
  employee: {
    email: 'cashier1@watermelonsoda.com',
    password: 'Password123!'
  },
  manager: {
    email: 'manager1@watermelonsoda.com',
    password: 'Password321!'
  },
  owner: {
    email: 'owner@watermelonsoda.com',
    password: 'Melon2026!'
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Encryption utility
export const encrypt = (text, key) => {
  return btoa(text); // Simple base64 for now - upgrade to AES-256 for production
};

export const decrypt = (text, key) => {
  return atob(text);
};

// State management
export let appState = {
  user: null,
  language: localStorage.getItem('pos_language') || 'en',
  currentShift: null,
  cart: {},
  payment: 'cash',
  isLoggedIn: false
};

// Language strings
export const translations = {
  en: {
    login: 'Login',
    logout: 'Log out',
    employee: 'Employee',
    manager: 'Manager',
    owner: 'Owner',
    username: 'Username',
    password: 'Password',
    pin: 'PIN',
    products: 'Products',
    currentOrder: 'Current Order',
    total: 'Total',
    cash: 'Cash',
    card: 'Card',
    qr: 'QR',
    completeSale: 'Complete Sale',
    dashboard: 'Dashboard',
    inventory: 'Inventory',
    staff: 'Staff',
    reports: 'Reports',
    settings: 'Settings',
    addItem: 'Add an item',
    nSalesYet: 'No sales yet',
    startShift: 'Start Shift',
    endShift: 'End Shift',
    refund: 'Refund',
    void: 'Void',
    print: 'Print Receipt',
    searchTz: 'Search timezone...',
    addTz: 'Add Timezone',
    addBtn: 'Add'
  },
  ms: {
    login: 'Log Masuk',
    logout: 'Log Keluar',
    employee: 'Pekerja',
    manager: 'Pengurus',
    owner: 'Pemilik',
    username: 'Nama Pengguna',
    password: 'Kata Laluan',
    pin: 'PIN',
    products: 'Produk',
    currentOrder: 'Pesanan Semasa',
    total: 'Jumlah',
    cash: 'Tunai',
    card: 'Kad',
    qr: 'QR',
    completeSale: 'Selesaikan Jualan',
    dashboard: 'Papan Pemuka',
    inventory: 'Inventori',
    staff: 'Staf',
    reports: 'Laporan',
    settings: 'Tetapan',
    addItem: 'Tambah item',
    nSalesYet: 'Belum ada jualan',
    startShift: 'Mulai Shift',
    endShift: 'Akhiri Shift',
    refund: 'Bayaran Balik',
    void: 'Batal',
    print: 'Cetak Resit',
    searchTz: 'Cari timezone...',
    addTz: 'Tambah Timezone',
    addBtn: 'Tambah'
  }
};

export const t = (key) => translations[appState.language][key] || key;

// Auth service
export const authService = {
  async login(username, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: username,
        password: password
      });
      if (error) throw error;
      appState.isLoggedIn = true;
      appState.user = data.user;
      localStorage.setItem('pos_user', JSON.stringify(data.user));
      return data.user;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },

  async logout() {
    await supabase.auth.signOut();
    appState.isLoggedIn = false;
    appState.user = null;
    localStorage.removeItem('pos_user');
  },

  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }
};

// Database service
export const dbService = {
  async getProducts() {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('id');
    if (error) throw error;
    return data;
  },

  async getStaff() {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('active', true);
    if (error) throw error;
    return data;
  },

  async saveSale(saleData) {
    const { data, error } = await supabase
      .from('sales')
      .insert([{
        ...saleData,
        created_at: new Date().toISOString(),
        encrypted_data: encrypt(JSON.stringify(saleData))
      }]);
    if (error) throw error;
    return data;
  },

  async getSalesReport(startDate, endDate, outletId = null) {
    let query = supabase
      .from('sales')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate);
    
    if (outletId) {
      query = query.eq('outlet_id', outletId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async logAuditTrail(action, details, userId) {
    const { error } = await supabase
      .from('audit_log')
      .insert([{
        action,
        details: encrypt(JSON.stringify(details)),
        user_id: userId,
        timestamp: new Date().toISOString()
      }]);
    if (error) throw error;
  },

  async updateInventory(productId, quantity) {
    const { data, error } = await supabase
      .from('inventory')
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq('product_id', productId);
    if (error) throw error;
    return data;
  },

  async startShift(staffId, outletId) {
    const { data, error } = await supabase
      .from('shifts')
      .insert([{
        staff_id: staffId,
        outlet_id: outletId,
        start_time: new Date().toISOString(),
        status: 'active'
      }]);
    if (error) throw error;
    return data[0];
  },

  async endShift(shiftId, cashCount) {
    const { data, error } = await supabase
      .from('shifts')
      .update({
        end_time: new Date().toISOString(),
        cash_count: cashCount,
        status: 'closed'
      })
      .eq('id', shiftId);
    if (error) throw error;
    return data[0];
  },

  async processRefund(saleId, amount, reason) {
    const { data, error } = await supabase
      .from('refunds')
      .insert([{
        sale_id: saleId,
        amount,
        reason,
        processed_at: new Date().toISOString(),
        status: 'completed'
      }]);
    if (error) throw error;
    return data[0];
  },

  async voidTransaction(saleId, reason) {
    const { data, error } = await supabase
      .from('sales')
      .update({ status: 'voided', void_reason: reason })
      .eq('id', saleId);
    if (error) throw error;
    return data[0];
  }
};
