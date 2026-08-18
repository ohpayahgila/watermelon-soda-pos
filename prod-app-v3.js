import { supabase, money, escapeHtml, toast } from './config.js';

const app = document.getElementById('app');

const state = {
  authUser: null,
  staff: null,
  outlet: null,
  products: [],
  ingredients: [],
  recipes: [],
  cart: new Map(),
  paymentMethod: 'cash',
  activeView: 'pos',
  editingProductId: null,
  discount: 0,
  orderNote: '',
  heldOrders: [],
  activeShift: null,
  recentSale: null,
  promotions: [],
  customer: null,
  loyaltyRedeemPoints: 0,
  activePromotion: null,
  approvalToken: null,
  notifications: [],
  dashboardOutletId: 'all',
};

const roleRank = { cashier: 1, supervisor: 2, manager: 3, owner: 4 };
const hasRole = (minimum) => (roleRank[state.staff?.role] || 0) >= roleRank[minimum];
const canManage = () => hasRole('manager');
const canSupervise = () => hasRole('supervisor');
const isOwner = () => state.staff?.role === 'owner';

boot();

async function boot() {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      return renderLogin();
    }

    await hydrateSession(session.user);
    await loadCoreData();
    renderShell();
  } catch (error) {
    console.error(error);
    renderFatal(error.message || 'Could not start POS');
  }
}

async function hydrateSession(user) {
  state.authUser = user;

  const { data: staff, error } = await supabase
    .from('staff')
   .select(`
  id,
  auth_user_id,
  outlet_id,
  name,
  email,
  role,
  active,
  outlets!staff_outlet_id_fkey(
    id,
    name,
    location
  )
`)
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .single();

  if (error || !staff) {
    console.error('Staff profile error:', error);
    await supabase.auth.signOut();
    throw new Error(
      'Your login exists, but no active staff profile is linked to it.'
    );
  }

  state.staff = staff;
  state.outlet = staff.outlets || {
    id: staff.outlet_id,
    name: 'Outlet'
  };
}

async function loadCoreData() {
  const [productsRes, ingredientsRes, recipesRes, promosRes, shiftRes] = await Promise.all([
    supabase.from('products').select('id,name,sku,description,category,price,active').order('category').order('name'),
    supabase.from('ingredients').select('id,name,unit,active,ingredient_inventory(quantity,reorder_level,outlet_id)').order('name'),
    supabase.from('product_ingredients').select('product_id,ingredient_id,quantity_required'),
    supabase.from('promotions').select('*').eq('active', true).order('created_at', {ascending:false}),
    supabase.from('shifts').select('*').eq('staff_id', state.staff.id).eq('status','active').order('start_time',{ascending:false}).limit(1)
  ]);
  if (productsRes.error) throw productsRes.error;
  if (ingredientsRes.error && ingredientsRes.error.code !== '42P01') throw ingredientsRes.error;
  if (recipesRes.error && recipesRes.error.code !== '42P01') throw recipesRes.error;
  state.products = productsRes.data || [];
  state.ingredients = (ingredientsRes.data || []).map(ingredient => ({...ingredient, inventory:(ingredient.ingredient_inventory||[]).find(inv=>inv.outlet_id===state.staff.outlet_id)||null}));
  state.recipes = recipesRes.data || [];
  state.promotions = promosRes.data || [];
  state.activeShift = shiftRes.data?.[0] || null;
  await loadNotifications();
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-card">

        <div class="login-brand">
          <img src="./logo.jpg" alt="Watermelon Soda logo">

          <div>
            <p class="eyebrow">Cloud POS</p>
            <h1>Watermelon Soda</h1>
            <p>Sign in with your staff account.</p>
          </div>
        </div>

        <form id="loginForm" class="form-stack">

          <label>
            Email
            <input
              id="email"
              type="email"
              autocomplete="username"
              required
              placeholder="name@watermelonsoda.com"
            >
          </label>

          <label>
            Password
            <input
              id="password"
              type="password"
              autocomplete="current-password"
              required
            >
          </label>

          <button class="btn primary" type="submit">
            Sign in
          </button>

          <p
            id="loginError"
            class="form-error"
            hidden
          ></p>

        </form>

      </section>
    </main>
  `;

  document
    .getElementById('loginForm')
    .addEventListener('submit', login);
}

async function login(event) {
  event.preventDefault();

  const button = event.submitter;
  const errorEl = document.getElementById('loginError');

  button.disabled = true;
  button.textContent = 'Signing in…';
  errorEl.hidden = true;

  const email =
    document.getElementById('email').value.trim();

  const password =
    document.getElementById('password').value;

  const { data, error } =
    await supabase.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;

    button.disabled = false;
    button.textContent = 'Sign in';

    return;
  }

  try {
    await hydrateSession(data.user);
    await loadCoreData();
    renderShell();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;

    button.disabled = false;
    button.textContent = 'Sign in';
  }
}

async function loadNotifications(){
  try{let q=supabase.from('pos_notifications').select('*').is('read_at',null).order('created_at',{ascending:false}).limit(30);if(!isOwner())q=q.eq('outlet_id',state.staff.outlet_id);const {data}=await q;state.notifications=data||[];}catch{state.notifications=[];}
}
function openNotifications(){modal(`<div class="form-stack"><div class="section-head"><div><p class="eyebrow">Operations</p><h2>Notifications</h2></div><button id="markAllRead" class="btn ghost small">Mark all read</button></div><div class="notification-list">${state.notifications.length?state.notifications.map(n=>`<div class="notification ${n.severity}"><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.message||'')}</p><small>${new Date(n.created_at).toLocaleString()}</small></div>`).join(''):'<div class="empty-state">You’re all caught up.</div>'}</div></div>`);document.getElementById('markAllRead').onclick=async()=>{if(state.notifications.length){await supabase.from('pos_notifications').update({read_at:new Date().toISOString()}).in('id',state.notifications.map(n=>n.id));}state.notifications=[];document.querySelector('.modal-backdrop')?.remove();renderShell();};}
function startNotificationRealtime(){if(window.__wsNotifyChannel)return;window.__wsNotifyChannel=supabase.channel('pos-notifications-v3').on('postgres_changes',{event:'INSERT',schema:'public',table:'pos_notifications'},async payload=>{const n=payload.new;if(isOwner()||n.outlet_id===state.staff?.outlet_id){state.notifications.unshift(n);toast(`🔔 ${n.title}`,'success');const badge=document.getElementById('notificationBadge');if(badge)badge.textContent=state.notifications.length;}}).subscribe();}
function renderShell() {
  const allowed = ['pos', 'orders', 'shift'];
  if (canSupervise()) allowed.push('inventory');
  if (canManage()) allowed.push('products', 'reports', 'dashboard', 'promotions', 'customers');
  if (isOwner()) allowed.push('staff');
  if (!allowed.includes(state.activeView)) state.activeView = canManage() ? 'dashboard' : 'pos';

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-lockup">
          <img src="./logo.jpg" alt="">
          <div>
            <strong>Watermelon Soda</strong>
            <small>${escapeHtml(state.outlet?.name || 'Outlet')}</small>
          </div>
        </div>

        <nav class="main-nav" aria-label="Main navigation">
          ${canManage() ? navButton('dashboard', 'Dashboard') : ''}
          ${navButton('pos', 'POS')}
          ${navButton('orders', 'Orders')}
          ${navButton('shift', 'Shift')}
          ${canManage() ? navButton('products', 'Products') : ''}
          ${canSupervise() ? navButton('inventory', 'Inventory') : ''}
          ${canManage() ? navButton('reports', 'Reports') : ''}
          ${canManage() ? navButton('promotions', 'Promos') : ''}
          ${canManage() ? navButton('customers', 'Customers') : ''}
          ${isOwner() ? navButton('staff', 'Staff') : ''}
        </nav>

        <div class="user-box">
          <div>
            <strong>${escapeHtml(state.staff.name)}</strong>
            <small>${escapeHtml(state.staff.role)}</small>
          </div>
          <button id="notificationBtn" class="notification-btn" title="Notifications">🔔 <span id="notificationBadge">${state.notifications.length}</span></button><button id="logoutBtn" class="btn ghost small">Log out</button>
        </div>
      </header>
      <main id="view"></main>
    </div>
  `;

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () => {
      state.activeView = button.dataset.view;
      renderShell();
    };
  });
  document.getElementById('notificationBtn')?.addEventListener('click', openNotifications);
  startNotificationRealtime();
  document.getElementById('logoutBtn').onclick = logout;
  renderActiveView();
}

function navButton(view, label) {
  return `<button data-view="${view}" class="nav-link ${state.activeView === view ? 'active' : ''}">${label}</button>`;
}

function renderActiveView() {
  if (state.activeView === 'dashboard') return renderDashboard();
  if (state.activeView === 'orders') return renderOrders();
  if (state.activeView === 'shift') return renderShift();
  if (state.activeView === 'products') return renderProducts();
  if (state.activeView === 'inventory') return renderInventory();
  if (state.activeView === 'reports') return renderReports();
  if (state.activeView === 'promotions') return renderPromotions();
  if (state.activeView === 'customers') return renderCustomers();
  if (state.activeView === 'staff') return renderStaffAdmin();
  return renderPOS();
}

function renderPOS() {
  const view = document.getElementById('view');
  const categories = [...new Set(state.products.filter(p => p.active).map(p => p.category || 'Drinks'))];
  const shiftText = state.activeShift ? 'Shift active' : 'No active shift';

  view.innerHTML = `
    <section class="pos-layout">
      <div class="catalog-panel">
        <div class="pos-statusbar">
          <span class="status on">● ONLINE</span>
          <span>${escapeHtml(state.staff.name)} • ${escapeHtml(state.staff.role)}</span>
          <span>${shiftText}</span>
        </div>
        <div class="section-head">
          <div><p class="eyebrow">Sell</p><h1>New order</h1></div>
          <input id="productSearch" class="search" placeholder="Search products">
        </div>
        <div class="category-strip">
          <button class="chip active" data-category="all">All</button>
          ${categories.map(c => `<button class="chip" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
        </div>
        <div id="productGrid" class="product-grid"></div>
      </div>

      <aside class="cart-panel">
        <div class="section-head">
          <div><p class="eyebrow">Current order</p><h2>Cart</h2></div>
          <button id="clearCart" class="btn ghost small">Clear</button>
        </div>
        <div id="cartItems" class="cart-items"></div>
        <div class="cart-footer">
          <div class="order-tools">
            <button id="holdOrderBtn" class="btn ghost small">Hold</button>
            <button id="discountBtn" class="btn ghost small">Manual discount</button>
            <button id="promoBtn" class="btn ghost small">Promo</button>
            <button id="customerBtn" class="btn ghost small">Customer</button>
            <button id="noteBtn" class="btn ghost small">Note</button>
          </div>
          <div id="promoSummary" class="promo-summary"></div><div id="customerSummary" class="customer-summary"></div><div class="summary-lines">
            <div><span>Subtotal</span><strong id="cartSubtotal">RM0.00</strong></div>
            <div><span>Discount</span><strong id="cartDiscount">RM0.00</strong></div>
          </div>
          <div class="grand-total"><span>Total</span><strong id="cartTotal">RM0.00</strong></div>
          <button id="checkoutBtn" class="btn primary checkout">Pay</button>
          <button id="heldOrdersBtn" class="held-link">Held orders (${getHeldOrders().length})</button>
        </div>
      </aside>
    </section>
  `;

  renderProductGrid('all', '');
  renderCart();
  let activeCategory = 'all';
  document.querySelectorAll('[data-category]').forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll('[data-category]').forEach(i => i.classList.remove('active'));
      button.classList.add('active');
      activeCategory = button.dataset.category;
      renderProductGrid(activeCategory, document.getElementById('productSearch').value);
    };
  });
  document.getElementById('productSearch').oninput = (e) => renderProductGrid(activeCategory, e.target.value);
  document.getElementById('clearCart').onclick = () => { state.cart.clear(); state.discount = 0; state.orderNote = ''; state.activePromotion=null; state.customer=null; state.loyaltyRedeemPoints=0; renderCart(); };
  document.getElementById('checkoutBtn').onclick = openPaymentModal;
  document.getElementById('holdOrderBtn').onclick = holdCurrentOrder;
  document.getElementById('heldOrdersBtn').onclick = openHeldOrders;
  document.getElementById('discountBtn').onclick = openDiscountModal;
  document.getElementById('promoBtn').onclick = openPromoModal;
  document.getElementById('customerBtn').onclick = openCustomerModal;
  document.getElementById('noteBtn').onclick = openNoteModal;
}

function productBaseName(name='') {
  return name.replace(/\s*[-–—|/]?\s*(\d{2}\s*oz|\d+\s*ml|small|medium|large)\s*$/i,'').trim() || name;
}
function productVariantLabel(name='') {
  const m=name.match(/(\d{2}\s*oz|\d+\s*ml|small|medium|large)\s*$/i);
  return m ? m[1].replace(/\s+/g,'').toUpperCase() : 'Standard';
}
function renderProductGrid(category='all', search='') {
  const grid=document.getElementById('productGrid'); if(!grid)return;
  const query=search.trim().toLowerCase();
  const filtered=state.products.filter(p=>p.active && (category==='all'||(p.category||'Drinks')===category) && (!query||`${p.name} ${p.sku||''}`.toLowerCase().includes(query)));
  const groups=new Map();
  filtered.forEach(p=>{const key=`${p.category||'Drinks'}::${productBaseName(p.name)}`; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
  grid.innerHTML=groups.size?[...groups.values()].map(group=>{const p=group[0]; const min=Math.min(...group.map(x=>Number(x.price))); return `<button class="product-card" data-product-group="${escapeHtml(productBaseName(p.name))}" data-category-name="${escapeHtml(p.category||'Drinks')}"><span class="product-category">${escapeHtml(p.category||'Drinks')}</span><strong>${escapeHtml(productBaseName(p.name))}</strong><span>${group.length>1?`From ${money.format(min)}`:money.format(Number(p.price))}</span>${group.length>1?`<small class="variant-count">${group.length} sizes</small>`:''}</button>`;}).join(''):`<div class="empty-state">No products found.</div>`;
  grid.querySelectorAll('[data-product-group]').forEach(btn=>btn.onclick=()=>openVariantSelector(btn.dataset.productGroup,btn.dataset.categoryName));
}
function openVariantSelector(base, category) {
  const variants=state.products.filter(p=>p.active && productBaseName(p.name)===base && (p.category||'Drinks')===category);
  if(variants.length===1){addToCart(variants[0].id);return;}
  modal(`<div class="variant-modal"><p class="eyebrow">Choose size</p><h2>${escapeHtml(base)}</h2><div class="variant-grid">${variants.sort((a,b)=>Number(a.price)-Number(b.price)).map(p=>`<button class="variant-tile" data-variant="${p.id}"><strong>${escapeHtml(productVariantLabel(p.name))}</strong><span>${money.format(Number(p.price))}</span></button>`).join('')}</div></div>`);
  document.querySelectorAll('[data-variant]').forEach(b=>b.onclick=()=>{addToCart(b.dataset.variant);document.querySelector('.modal-backdrop')?.remove();});
}

function addToCart(id) {
  state.cart.set(
    id,
    (state.cart.get(id) || 0) + 1
  );

  renderCart();
}

function changeQty(id, delta) {
  const quantity =
    (state.cart.get(id) || 0) +
    delta;

  if (quantity <= 0) {
    state.cart.delete(id);
  } else {
    state.cart.set(id, quantity);
  }

  renderCart();
}

function cartSummary() {
  const base=cartSummaryRaw();
  refreshPromotionDiscount();
  const promoDiscount=Math.min(Math.max(Number(state.discount)||0,0),base.subtotal);
  const maxRedeem=Math.min(Number(state.customer?.points||0), Math.floor((base.subtotal-promoDiscount)*10));
  const redeemPoints=Math.min(Number(state.loyaltyRedeemPoints)||0,maxRedeem);
  const loyaltyDiscount=redeemPoints/10;
  return {lines:base.lines,subtotal:base.subtotal,discount:promoDiscount,loyaltyDiscount,redeemPoints,total:Math.max(0,base.subtotal-promoDiscount-loyaltyDiscount)};
}

function renderCart() {
  const box=document.getElementById('cartItems'); if(!box)return; const {lines,subtotal,discount,loyaltyDiscount,redeemPoints,total}=cartSummary();
  box.innerHTML=lines.length?lines.map(({product,quantity})=>`<div class="cart-line"><div><strong>${escapeHtml(productBaseName(product.name))}</strong><small>${escapeHtml(productVariantLabel(product.name))} · ${money.format(Number(product.price))} each</small></div><div class="qty-control"><button data-minus="${product.id}">−</button><span>${quantity}</span><button data-plus="${product.id}">+</button></div><strong>${money.format(Number(product.price)*quantity)}</strong></div>`).join(''):`<div class="empty-state compact">Tap a product to start an order.</div>`;
  const sub=document.getElementById('cartSubtotal');if(sub)sub.textContent=money.format(subtotal);const disc=document.getElementById('cartDiscount');if(disc)disc.textContent=money.format(discount+loyaltyDiscount);const tot=document.getElementById('cartTotal');if(tot)tot.textContent=money.format(total);const pay=document.getElementById('checkoutBtn');if(pay)pay.textContent=`Pay ${money.format(total)}`;
  const promo=document.getElementById('promoSummary');if(promo)promo.innerHTML=state.appliedPromotion?`<span>🎟️ ${escapeHtml(state.appliedPromotion.name)}</span><strong>−${money.format(discount)}</strong>`:'';
  const cust=document.getElementById('customerSummary');if(cust)cust.innerHTML=state.customer?`<div><span>👤 ${escapeHtml(state.customer.name||state.customer.phone)}</span><strong>${state.customer.points} pts</strong></div>${state.customer.points>0?`<label class="redeem-row"><input id="redeemPoints" type="range" min="0" max="${Math.min(state.customer.points,Math.floor((subtotal-discount)*10))}" step="10" value="${redeemPoints}"><small>Redeem ${redeemPoints} pts = ${money.format(loyaltyDiscount)}</small></label>`:''}`:'';
  document.getElementById('redeemPoints')?.addEventListener('input',e=>{state.loyaltyRedeemPoints=Number(e.target.value);renderCart();});
  box.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));box.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));
}

function getHeldOrders() {
  try { return JSON.parse(localStorage.getItem('ws_held_orders') || '[]'); } catch { return []; }
}
function saveHeldOrders(rows) { localStorage.setItem('ws_held_orders', JSON.stringify(rows)); }
function holdCurrentOrder() {
  const summary = cartSummary();
  if (!summary.lines.length) return toast('Nothing to hold', 'error');
  const rows = getHeldOrders();
  rows.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), cart: [...state.cart.entries()], discount: state.discount, note: state.orderNote });
  saveHeldOrders(rows.slice(0, 20)); state.cart.clear(); state.discount = 0; state.orderNote = ''; state.activePromotion=null; state.customer=null; state.loyaltyRedeemPoints=0; renderPOS(); toast('Order held', 'success');
}
function openHeldOrders() {
  const rows = getHeldOrders();
  modal(`<div class="section-head"><div><p class="eyebrow">Queue</p><h2>Held orders</h2></div></div>
    <div class="held-orders">${rows.length ? rows.map((r,i)=>`<button class="held-order" data-held="${r.id}"><strong>Order ${i+1}</strong><span>${new Date(r.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></button>`).join('') : '<div class="empty-state">No held orders.</div>'}</div>`);
  document.querySelectorAll('[data-held]').forEach(b => b.onclick = () => {
    const r = rows.find(x => x.id === b.dataset.held); if (!r) return;
    state.cart = new Map(r.cart); state.discount = r.discount || 0; state.orderNote = r.note || '';
    saveHeldOrders(rows.filter(x => x.id !== r.id)); document.querySelector('.modal-backdrop')?.remove(); renderPOS(); toast('Held order restored','success');
  });
}
function activePromotionsNow() {
  const now=new Date(); const dow=now.getDay(); const mins=now.getHours()*60+now.getMinutes();
  return state.promotions.filter(p=>{
    if(!p.active)return false;
    if(p.starts_at && now<new Date(p.starts_at))return false; if(p.ends_at && now>new Date(p.ends_at))return false;
    if(Array.isArray(p.days_of_week)&&p.days_of_week.length&&!p.days_of_week.includes(dow))return false;
    if(p.start_time&&p.end_time){const [sh,sm]=p.start_time.split(':').map(Number),[eh,em]=p.end_time.split(':').map(Number); if(mins<sh*60+sm||mins>eh*60+em)return false;}
    return true;
  });
}
function promotionDiscount(promo, summary) {
  if(!promo)return 0; let eligible=summary.subtotal;
  const ids=promo.applies_product_ids||[];
  if(ids.length) eligible=summary.lines.filter(x=>ids.includes(x.product.id)).reduce((a,x)=>a+Number(x.product.price)*x.quantity,0);
  if(promo.rule_type==='bundle'){
    const qty=summary.lines.filter(x=>!ids.length||ids.includes(x.product.id)).reduce((a,x)=>a+x.quantity,0); const bundles=Math.floor(qty/Math.max(1,Number(promo.bundle_qty)||2));
    if(!bundles)return 0; const normalUnit=eligible/Math.max(1,qty); return Math.max(0,bundles*((normalUnit*Number(promo.bundle_qty||2))-Number(promo.bundle_price||0)));
  }
  return promo.discount_type==='percent'?eligible*(Number(promo.discount_value||0)/100):Math.min(eligible,Number(promo.discount_value||0));
}
function refreshPromotionDiscount() {
  const base=cartSummaryRaw(); const auto=activePromotionsNow().filter(p=>p.auto_apply&&!p.code).map(p=>({p,d:promotionDiscount(p,base)})).sort((a,b)=>b.d-a.d)[0];
  const chosen=state.activePromotion; const chosenD=chosen?promotionDiscount(chosen,base):0; const winner=chosenD>=(auto?.d||0)?(chosen?{p:chosen,d:chosenD}:null):auto;
  state.discount=Math.min(base.subtotal,winner?.d||0); state.appliedPromotion=winner?.p||null;
}
function cartSummaryRaw(){const lines=[...state.cart.entries()].map(([id,quantity])=>({product:state.products.find(p=>p.id===id),quantity})).filter(x=>x.product);const subtotal=lines.reduce((a,x)=>a+Number(x.product.price)*x.quantity,0);return{lines,subtotal};}
async function requestManagerApproval(action, amount=0) {
  return new Promise(resolve=>{
    modal(`<form id="approvalForm" class="form-stack"><div><p class="eyebrow">Manager approval</p><h2>Approval required</h2><p class="muted">A Supervisor, Manager or Owner can enter their PIN without logging the cashier out.</p></div><label>Approval PIN<input id="approvalPin" type="password" inputmode="numeric" minlength="4" maxlength="8" required autofocus></label><button class="btn primary">Approve ${escapeHtml(action)}</button></form>`);
    document.getElementById('approvalForm').onsubmit=async e=>{e.preventDefault();const pin=document.getElementById('approvalPin').value;const {data,error}=await supabase.rpc('approve_pos_action_v3',{p_pin:pin,p_action:action,p_amount:Number(amount)||0});if(error||!data){toast(error?.message||'Approval failed','error');return;}document.querySelector('.modal-backdrop')?.remove();state.approvalToken=data;toast('Approved','success');resolve(data);};
  });
}
async function openPromoModal(){
  const summary=cartSummaryRaw(); if(!summary.lines.length)return toast('Add products first','error');
  const promos=activePromotionsNow(); modal(`<div class="form-stack"><div><p class="eyebrow">Promotions</p><h2>Apply offer</h2></div><label>Promo code<input id="promoCode" placeholder="Enter code"></label><button id="applyCode" class="btn primary">Apply code</button><div class="promo-picker">${promos.filter(p=>p.auto_apply||!p.code).map(p=>`<button class="promo-option" data-promo-id="${p.id}"><strong>${escapeHtml(p.name)}</strong><small>${p.rule_type==='bundle'?`Bundle ${p.bundle_qty} for ${money.format(Number(p.bundle_price))}`:p.discount_type==='percent'?`${p.discount_value}% off`:`${money.format(Number(p.discount_value))} off`}</small></button>`).join('')||'<div class="empty-state compact">No active offers right now.</div>'}</div><button id="clearPromo" class="btn ghost">Remove promotion</button></div>`);
  const apply=p=>{state.activePromotion=p;refreshPromotionDiscount();document.querySelector('.modal-backdrop')?.remove();renderCart();toast(`${p.name} applied`,'success');};
  document.querySelectorAll('[data-promo-id]').forEach(b=>b.onclick=()=>apply(promos.find(p=>p.id===b.dataset.promoId)));
  document.getElementById('applyCode').onclick=()=>{const code=document.getElementById('promoCode').value.trim().toLowerCase();const p=promos.find(x=>x.code?.toLowerCase()===code);if(!p)return toast('Promo code is not valid right now','error');apply(p);};
  document.getElementById('clearPromo').onclick=()=>{state.activePromotion=null;state.discount=0;document.querySelector('.modal-backdrop')?.remove();renderCart();};
}
async function openCustomerModal(){
  modal(`<form id="customerFind" class="form-stack"><div><p class="eyebrow">Loyalty</p><h2>Customer</h2></div><label>Phone number<input id="customerPhone" type="tel" required placeholder="01xxxxxxxx"></label><button class="btn primary">Find customer</button><div id="customerResult"></div></form>`);
  document.getElementById('customerFind').onsubmit=async e=>{e.preventDefault();const phone=document.getElementById('customerPhone').value.trim();const {data}=await supabase.from('customers').select('*').eq('phone',phone).maybeSingle();const box=document.getElementById('customerResult');if(data){box.innerHTML=`<div class="customer-card"><strong>${escapeHtml(data.name||data.phone)}</strong><span>${data.points} points</span><button type="button" id="attachCustomer" class="btn ghost small">Attach to order</button></div>`;document.getElementById('attachCustomer').onclick=()=>{state.customer=data;document.querySelector('.modal-backdrop')?.remove();renderCart();toast('Customer attached','success');};}else{box.innerHTML=`<div class="form-stack"><p>No customer found. Create one:</p><label>Name<input id="newCustomerName"></label><button type="button" id="createCustomer" class="btn ghost">Create customer</button></div>`;document.getElementById('createCustomer').onclick=async()=>{const name=document.getElementById('newCustomerName').value.trim();const {data:newC,error}=await supabase.from('customers').insert({phone,name:name||null}).select().single();if(error)return toast(error.message,'error');state.customer=newC;document.querySelector('.modal-backdrop')?.remove();renderCart();toast('Customer created and attached','success');};}};
}
function openDiscountModal() {
  const {subtotal}=cartSummaryRaw(); if(!subtotal)return toast('Add products first','error');
  modal(`<form id="discountForm" class="form-stack"><div><p class="eyebrow">Order</p><h2>Manual discount</h2><p class="muted">Manual discounts override automatic promotions.</p></div><label>Discount amount (RM)<input id="discountAmount" type="number" min="0" max="${subtotal}" step="0.01" value="0" required></label><button class="btn primary">Apply</button></form>`);
  document.getElementById('discountForm').onsubmit=async e=>{e.preventDefault();const amount=Math.min(Number(document.getElementById('discountAmount').value)||0,subtotal);if(state.staff.role==='cashier'){document.querySelector('.modal-backdrop')?.remove();const token=await requestManagerApproval('discount',amount);if(!token)return;}state.activePromotion={id:null,name:'Manual discount',discount_type:'fixed',discount_value:amount,rule_type:'discount',manual:true};state.discount=amount;document.querySelector('.modal-backdrop')?.remove();renderCart();};
}
function openNoteModal() {
  modal(`<form id="noteForm" class="form-stack"><div><p class="eyebrow">Order</p><h2>Order note</h2></div><label>Note<textarea id="orderNote" rows="4" placeholder="Optional note">${escapeHtml(state.orderNote)}</textarea></label><button class="btn primary">Save note</button></form>`);
  document.getElementById('noteForm').onsubmit = e => { e.preventDefault(); state.orderNote = document.getElementById('orderNote').value.trim(); document.querySelector('.modal-backdrop')?.remove(); toast('Note saved','success'); };
}
function openPaymentModal() {
  const { lines, total } = cartSummary(); if (!lines.length) return toast('Add at least one product','error');
  modal(`<div class="payment-modal"><p class="eyebrow">Payment</p><h2>${money.format(total)}</h2><div class="payment-choice"><button class="pay-tile active" data-method="cash">Cash</button><button class="pay-tile" data-method="qr">DuitNow QR</button><button class="pay-tile" data-method="card">Card</button><button class="pay-tile" data-method="ewallet">E-wallet</button></div><div id="cashBox" class="cash-box"><label>Cash received<input id="cashReceived" type="number" min="${total}" step="0.01" placeholder="${total.toFixed(2)}"></label><div class="quick-cash"><button data-cash="${Math.ceil(total/5)*5}">RM${Math.ceil(total/5)*5}</button><button data-cash="20">RM20</button><button data-cash="50">RM50</button><button data-cash="100">RM100</button></div><div class="change-line"><span>Change</span><strong id="changeAmount">RM0.00</strong></div></div><button id="completePayment" class="btn primary checkout">Complete sale</button></div>`);
  state.paymentMethod='cash';
  document.querySelectorAll('[data-method]').forEach(b => b.onclick=()=>{ state.paymentMethod=b.dataset.method; document.querySelectorAll('[data-method]').forEach(x=>x.classList.toggle('active',x===b)); document.getElementById('cashBox').hidden=state.paymentMethod!=='cash'; });
  const input=document.getElementById('cashReceived'); const update=()=>document.getElementById('changeAmount').textContent=money.format(Math.max(0,(Number(input.value)||0)-total)); input.oninput=update;
  document.querySelectorAll('[data-cash]').forEach(b=>b.onclick=()=>{input.value=b.dataset.cash;update();});
  document.getElementById('completePayment').onclick=()=>checkout();
}

async function checkout() {
  const {lines,discount,redeemPoints,total}=cartSummary(); if(!lines.length)return toast('Add at least one product','error');
  if(state.paymentMethod==='cash'){const received=Number(document.getElementById('cashReceived')?.value||0);if(received<total)return toast('Cash received is less than total','error');}
  const button=document.getElementById('completePayment');if(button){button.disabled=true;button.textContent='Processing…';}
  try{
    const payload=lines.map(item=>({product_id:item.product.id,quantity:item.quantity}));
    const {data,error}=await supabase.rpc('complete_pos_sale_v3',{p_payment_method:state.paymentMethod,p_items:payload,p_discount:discount,p_notes:state.orderNote||null,p_customer_id:state.customer?.id||null,p_redeem_points:redeemPoints,p_promotion_id:state.appliedPromotion?.id||null,p_approval_token:state.approvalToken||null});if(error)throw error;
    const sale=Array.isArray(data)?data[0]:data; state.cart.clear();state.discount=0;state.orderNote='';state.recentSale=sale;state.activePromotion=null;state.customer=null;state.loyaltyRedeemPoints=0;state.approvalToken=null;document.querySelector('.modal-backdrop')?.remove();await loadCoreData();showPaymentSuccess(sale,total);
  }catch(error){console.error(error);toast(error.message||'Sale failed','error');if(button){button.disabled=false;button.textContent='Complete sale';}}
}
function showPaymentSuccess(sale,total){
  modal(`<div class="success-card"><div class="success-check">✓</div><p class="eyebrow">Payment successful</p><h2>${money.format(total)}</h2><p>${escapeHtml(sale?.receipt_number || '')}</p><div class="success-actions"><button id="newOrder" class="btn primary">New order</button><button id="receiptBtn" class="btn ghost">Receipt</button></div></div>`);
  document.getElementById('newOrder').onclick=()=>{document.querySelector('.modal-backdrop')?.remove();renderPOS();};
  document.getElementById('receiptBtn').onclick=()=>printReceiptWindow(sale);
}

async function printReceiptWindow(sale) {
  let full=sale;
  if(!sale?.items && sale?.id){const {data}=await supabase.from('sales').select('id,receipt_number,total,subtotal,discount,payment_method,created_at,notes,sale_items(product_name,quantity,unit_price,subtotal)').eq('id',sale.id).single();if(data)full={...data,items:data.sale_items||[]};}
  const items=full?.items||full?.sale_items||[]; const windowRef=window.open('','_blank','width=420,height=720');if(!windowRef)return toast('Pop-up blocked. Allow pop-ups to print receipts.','error');
  windowRef.document.write(`<html><head><title>${escapeHtml(full.receipt_number||'Receipt')}</title><style>body{font-family:system-ui;padding:24px;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid #ddd}.r{text-align:right}.total{font-size:20px;font-weight:800}</style></head><body><h1>Watermelon Soda</h1><p>${escapeHtml(state.outlet?.name||'')}</p><p>${escapeHtml(full.receipt_number||'')}<br>${new Date(full.created_at||Date.now()).toLocaleString('en-MY')}</p><table>${items.map(item=>`<tr><td>${escapeHtml(item.product_name)} × ${item.quantity}</td><td class="r">${money.format(Number(item.subtotal))}</td></tr>`).join('')}<tr class="total"><td>Total</td><td class="r">${money.format(Number(full.total||0))}</td></tr></table><p>Payment: ${escapeHtml((full.payment_method||state.paymentMethod||'').toUpperCase())}</p><p>Thank you!</p><script>window.onload=()=>window.print()<\/script></body></html>`);windowRef.document.close();
}


async function renderDashboard() {
  const view=document.getElementById('view');view.innerHTML=`<section class="management-page"><div class="section-head"><div><p class="eyebrow">Live business</p><h1>Dashboard</h1></div><div id="outletFilterWrap"></div></div><div class="empty-state">Loading performance…</div></section>`;
  let outlets=[];if(isOwner()){const {data}=await supabase.from('outlets').select('id,name').order('name');outlets=data||[];document.getElementById('outletFilterWrap').innerHTML=`<select id="dashboardOutlet" class="search"><option value="all">All outlets</option>${outlets.map(o=>`<option value="${o.id}" ${state.dashboardOutletId===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}</select>`;document.getElementById('dashboardOutlet').onchange=e=>{state.dashboardOutletId=e.target.value;renderDashboard();};}else state.dashboardOutletId=state.staff.outlet_id;
  const today=new Date();today.setHours(0,0,0,0);const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  let q=supabase.from('sales').select('id,total,payment_method,created_at,status,outlet_id,staff(name),sale_items(quantity,product_name,subtotal)').gte('created_at',yesterday.toISOString()).neq('status','voided').order('created_at');if(state.dashboardOutletId!=='all')q=q.eq('outlet_id',state.dashboardOutletId);const {data:sales,error}=await q;if(error){view.innerHTML+=`<div class="empty-state">${escapeHtml(error.message)}</div>`;return;}
  const all=sales||[],rows=all.filter(s=>new Date(s.created_at)>=today),prev=all.filter(s=>new Date(s.created_at)<today);const revenue=rows.reduce((a,s)=>a+Number(s.total||0),0),prevRevenue=prev.reduce((a,s)=>a+Number(s.total||0),0),orders=rows.length,avg=orders?revenue/orders:0,change=prevRevenue?((revenue-prevRevenue)/prevRevenue)*100:(revenue?100:0);
  const items=new Map();rows.flatMap(s=>s.sale_items||[]).forEach(i=>items.set(i.product_name,(items.get(i.product_name)||0)+Number(i.quantity||0)));const best=[...items.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);const payments={};rows.forEach(s=>payments[s.payment_method]=(payments[s.payment_method]||0)+Number(s.total||0));const hours=Array.from({length:18},(_,i)=>i+6).map(h=>({h,v:rows.filter(s=>new Date(s.created_at).getHours()===h).reduce((a,s)=>a+Number(s.total||0),0)})),max=Math.max(1,...hours.map(x=>x.v));
  let invQ=supabase.from('ingredient_inventory').select('quantity,reorder_level,outlet_id,ingredients(name,unit)').lte('quantity',999999);if(state.dashboardOutletId!=='all')invQ=invQ.eq('outlet_id',state.dashboardOutletId);const {data:inv}=await invQ;const low=(inv||[]).filter(i=>Number(i.quantity)<=Number(i.reorder_level));
  view.innerHTML=`<section class="management-page dashboard-page"><div class="section-head"><div><p class="eyebrow">Live business</p><h1>Today</h1><p>${state.dashboardOutletId==='all'?'All outlets':'Selected outlet'}</p></div><div>${isOwner()?`<select id="dashboardOutlet" class="search"><option value="all">All outlets</option>${outlets.map(o=>`<option value="${o.id}" ${state.dashboardOutletId===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}</select>`:''}</div></div><div class="metrics metrics-4"><div class="metric-card"><span>Revenue</span><strong>${money.format(revenue)}</strong><small class="${change>=0?'trend-up':'trend-down'}">${change>=0?'↑':'↓'} ${Math.abs(change).toFixed(1)}% vs yesterday</small></div><div class="metric-card"><span>Orders</span><strong>${orders}</strong><small>Yesterday ${prev.length}</small></div><div class="metric-card"><span>Average order</span><strong>${money.format(avg)}</strong></div><div class="metric-card"><span>Items sold</span><strong>${[...items.values()].reduce((a,b)=>a+b,0)}</strong></div></div><div class="dashboard-grid"><div class="table-card dashboard-card"><div class="card-head"><h2>Sales by hour</h2></div><div class="hour-chart">${hours.map(x=>`<div class="bar-wrap"><div class="bar" style="height:${Math.max(3,(x.v/max)*140)}px" title="${money.format(x.v)}"></div><small>${String(x.h).padStart(2,'0')}</small></div>`).join('')}</div></div><div class="table-card dashboard-card"><div class="card-head"><h2>Best sellers</h2></div>${best.length?`<div class="rank-list">${best.map(([n,q],i)=>`<div><span>#${i+1} ${escapeHtml(n)}</span><strong>${q}</strong></div>`).join('')}</div>`:'<div class="empty-state compact">No sales yet.</div>'}</div><div class="table-card dashboard-card"><div class="card-head"><h2>Payment split</h2></div><div class="rank-list">${Object.entries(payments).map(([m,v])=>`<div><span>${escapeHtml(m.toUpperCase())}</span><strong>${money.format(v)}</strong></div>`).join('')||'<div class="empty-state compact">No payments yet.</div>'}</div><div class="table-card dashboard-card"><div class="card-head"><h2>Inventory alerts</h2></div><div class="alert-list">${low.length?low.slice(0,8).map(i=>`<div class="inventory-alert"><span class="status off">LOW</span><div><strong>${escapeHtml(i.ingredients?.name||'Ingredient')}</strong><small>${Number(i.quantity).toFixed(1)} ${escapeHtml(i.ingredients?.unit||'')} remaining</small></div></div>`).join(''):'<div class="empty-state compact">Stock levels look healthy.</div>'}</div></div></div></section>`;if(isOwner())document.getElementById('dashboardOutlet').onchange=e=>{state.dashboardOutletId=e.target.value;renderDashboard();};
}

async function renderOrders(){
  const view=document.getElementById('view');view.innerHTML=`<section class="management-page"><div class="section-head"><div><p class="eyebrow">Transactions</p><h1>Order history</h1></div><input id="orderSearch" class="search" placeholder="Receipt or customer"></div><div id="ordersTable" class="table-card"><div class="empty-state">Loading…</div></div></section>`;
  let q=supabase.from('sales').select('id,receipt_number,total,subtotal,discount,payment_method,status,created_at,notes,staff(name),customer_id,customers(name,phone)').order('created_at',{ascending:false}).limit(200);if(!isOwner())q=q.eq('outlet_id',state.staff.outlet_id);const {data,error}=await q;const rows=data||[];
  const paint=(term='')=>{const t=term.toLowerCase();const filt=rows.filter(r=>!t||`${r.receipt_number||''} ${r.customers?.name||''} ${r.customers?.phone||''}`.toLowerCase().includes(t));document.getElementById('ordersTable').innerHTML=error?`<div class="empty-state">${escapeHtml(error.message)}</div>`:`<table><thead><tr><th>Receipt</th><th>Time</th><th>Staff</th><th>Customer</th><th>Payment</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead><tbody>${filt.map(r=>`<tr><td><strong>${escapeHtml(r.receipt_number)}</strong></td><td>${new Date(r.created_at).toLocaleString()}</td><td>${escapeHtml(r.staff?.name||'')}</td><td>${escapeHtml(r.customers?.name||r.customers?.phone||'—')}</td><td>${escapeHtml(r.payment_method)}</td><td><span class="status ${r.status==='completed'?'on':'off'}">${escapeHtml(r.status)}</span></td><td>${money.format(Number(r.total))}</td><td><div class="table-actions"><button class="btn ghost small" data-receipt="${r.id}">Receipt</button>${r.status==='completed'?`<button class="btn ghost small" data-refund="${r.id}" data-total="${r.total}">Refund</button><button class="btn ghost small" data-void="${r.id}">Void</button>`:''}</div></td></tr>`).join('')}</tbody></table>`;
    document.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>printReceiptWindow({id:b.dataset.receipt}));document.querySelectorAll('[data-refund]').forEach(b=>b.onclick=()=>refundSale(b.dataset.refund,Number(b.dataset.total)));document.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>voidSale(b.dataset.void));};
  paint();document.getElementById('orderSearch').oninput=e=>paint(e.target.value);
}
async function refundSale(id,total){
  modal(`<form id="refundForm" class="form-stack"><div><p class="eyebrow">Refund</p><h2>Refund transaction</h2></div><label>Amount (RM)<input id="refundAmount" type="number" min="0.01" max="${total}" step="0.01" value="${total}" required></label><label>Reason<textarea id="refundReason" required></textarea></label><button class="btn primary">Process refund</button></form>`);
  document.getElementById('refundForm').onsubmit=async e=>{e.preventDefault();const amount=Number(document.getElementById('refundAmount').value);const reason=document.getElementById('refundReason').value.trim();document.querySelector('.modal-backdrop')?.remove();let token=null;if(!canManage())token=await requestManagerApproval('refund',amount);const {error}=await supabase.rpc('refund_pos_sale_v3',{p_sale_id:id,p_amount:amount,p_reason:reason,p_approval_token:token});if(error)return toast(error.message,'error');toast('Refund completed','success');renderOrders();};
}
async function voidSale(id){
  const reason=prompt('Reason for void:');if(!reason)return;let token=null;if(!canManage())token=await requestManagerApproval('void',0);const {error}=await supabase.rpc('void_pos_sale_v3',{p_sale_id:id,p_reason:reason,p_approval_token:token});if(error)return toast(error.message,'error');toast('Sale voided','success');renderOrders();
}


async function renderShift(){
  const view=document.getElementById('view'); const {data}=await supabase.from('shifts').select('*').eq('staff_id',state.staff.id).eq('status','active').order('start_time',{ascending:false}).limit(1).maybeSingle(); state.activeShift=data||null;
  view.innerHTML=`<section class="management-page"><div class="section-head"><div><p class="eyebrow">Staff</p><h1>Shift</h1><p>${state.activeShift?'You are currently clocked in.':'Start your shift before trading.'}</p></div></div><div class="shift-card">${state.activeShift?`<div><span>Started</span><strong>${new Date(state.activeShift.start_time).toLocaleString()}</strong></div><div><span>Opening cash</span><strong>${money.format(Number(state.activeShift.opening_cash||0))}</strong></div><button id="endShift" class="btn primary">End shift</button>`:`<form id="startShiftForm" class="form-stack"><label>Opening cash (RM)<input id="openingCash" type="number" min="0" step="0.01" value="0"></label><button class="btn primary">Start shift</button></form>`}</div></section>`;
  if(state.activeShift){document.getElementById('endShift').onclick=()=>openCloseShift();}else{document.getElementById('startShiftForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from('shifts').insert({staff_id:state.staff.id,outlet_id:state.staff.outlet_id,opening_cash:Number(document.getElementById('openingCash').value)||0});if(error)return toast(error.message,'error');toast('Shift started','success');renderShift();};}
}
function openCloseShift(){ modal(`<form id="closeShiftForm" class="form-stack"><div><p class="eyebrow">Reconciliation</p><h2>Close shift</h2></div><label>Closing cash (RM)<input id="closingCash" type="number" min="0" step="0.01" required></label><button class="btn primary">Close shift</button></form>`); document.getElementById('closeShiftForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from('shifts').update({closing_cash:Number(document.getElementById('closingCash').value),end_time:new Date().toISOString(),status:'closed'}).eq('id',state.activeShift.id);if(error)return toast(error.message,'error');document.querySelector('.modal-backdrop')?.remove();state.activeShift=null;await supabase.rpc('create_pos_notification_v3',{p_outlet_id:state.staff.outlet_id,p_severity:'info',p_title:'Shift closed',p_message:`${state.staff.name} closed a shift.`});toast('Shift closed','success');renderShift();}; }


async function renderStaffAdmin(){
  const view=document.getElementById('view'); view.innerHTML='<section class="management-page"><div class="section-head"><div><p class="eyebrow">Owner</p><h1>Staff access</h1><p>Cashier → Supervisor → Manager. Owner remains unrestricted.</p></div></div><div id="staffTable" class="table-card"><div class="empty-state">Loading…</div></div></section>';
  const {data,error}=await supabase
  .from('staff')
  .select(`
    id,
    name,
    email,
    role,
    active,
    outlet_id,
    outlets!staff_outlet_id_fkey(name)
  `)
  .order('name');
  if(error){document.getElementById('staffTable').innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;return;}
  document.getElementById('staffTable').innerHTML=`<table><thead><tr><th>Name</th><th>Email</th><th>Outlet</th><th>Access level</th><th>PIN</th><th>Active</th></tr></thead><tbody>${(data||[]).map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.outlets?.name||'—')}</td><td>${r.role==='owner'?'<span class="status on">OWNER</span>':`<select class="role-select" data-role-staff="${r.id}"><option value="cashier" ${r.role==='cashier'?'selected':''}>1 · Cashier</option><option value="supervisor" ${r.role==='supervisor'?'selected':''}>2 · Supervisor</option><option value="manager" ${r.role==='manager'?'selected':''}>3 · Manager</option></select>`}</td><td><button class="btn ghost small" data-set-pin="${r.id}">Set PIN</button></td><td>${r.role==='owner'?'—':`<input type="checkbox" data-active-staff="${r.id}" ${r.active?'checked':''}>`}</td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-role-staff]').forEach(el=>el.onchange=async()=>{const {error}=await supabase.from('staff').update({role:el.value}).eq('id',el.dataset.roleStaff); if(error){toast(error.message,'error');return renderStaffAdmin();} toast('Staff level updated','success');});
  document.querySelectorAll('[data-active-staff]').forEach(el=>el.onchange=async()=>{const {error}=await supabase.from('staff').update({active:el.checked}).eq('id',el.dataset.activeStaff); if(error){toast(error.message,'error');el.checked=!el.checked;}else toast('Staff status updated','success');});
  document.querySelectorAll('[data-set-pin]').forEach(el=>el.onclick=()=>{modal(`<form id="pinForm" class="form-stack"><div><p class="eyebrow">Security</p><h2>Set staff approval PIN</h2></div><label>New PIN<input id="newStaffPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required></label><button class="btn primary">Save PIN</button></form>`);document.getElementById('pinForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.rpc('set_staff_pin_v3',{p_staff_id:el.dataset.setPin,p_pin:document.getElementById('newStaffPin').value});if(error)return toast(error.message,'error');document.querySelector('.modal-backdrop')?.remove();toast('PIN updated','success');};});
}

async function renderPromotions(){
  const view=document.getElementById('view');view.innerHTML=`<section class="management-page"><div class="section-head"><div><p class="eyebrow">Sales tools</p><h1>Promotions</h1><p>Codes, happy hours, percentage discounts and bundles.</p></div><button id="newPromo" class="btn primary">New promotion</button></div><div id="promoTable" class="table-card"><div class="empty-state">Loading…</div></div></section>`;
  const load=async()=>{const {data,error}=await supabase.from('promotions').select('*').order('created_at',{ascending:false});document.getElementById('promoTable').innerHTML=error?`<div class="empty-state">${escapeHtml(error.message)}</div>`:`<table><thead><tr><th>Name</th><th>Code</th><th>Rule</th><th>Schedule</th><th>Status</th></tr></thead><tbody>${(data||[]).map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${escapeHtml(r.code||'Auto')}</td><td>${r.rule_type==='bundle'?`${r.bundle_qty} for ${money.format(Number(r.bundle_price))}`:r.discount_type==='percent'?`${Number(r.discount_value)}% off`:money.format(Number(r.discount_value))+' off'}</td><td>${r.start_time&&r.end_time?`${r.start_time.slice(0,5)}–${r.end_time.slice(0,5)}`:'Any time'}</td><td><span class="status ${r.active?'on':'off'}">${r.active?'ACTIVE':'OFF'}</span></td></tr>`).join('')}</tbody></table>`;};await load();
  document.getElementById('newPromo').onclick=()=>{modal(`<form id="promoForm" class="form-stack"><div><p class="eyebrow">Promotion</p><h2>New promotion</h2></div><label>Name<input name="name" required></label><label>Code<input name="code" placeholder="Leave blank for automatic offer"></label><label>Rule<select name="rule" id="promoRule"><option value="discount">Discount</option><option value="bundle">Bundle</option></select></label><div id="discountFields" class="form-two"><label>Type<select name="type"><option value="fixed">Fixed RM</option><option value="percent">Percent %</option></select></label><label>Value<input name="value" type="number" min="0" step="0.01" value="10"></label></div><div id="bundleFields" class="form-two" hidden><label>Bundle quantity<input name="bundleQty" type="number" min="2" value="2"></label><label>Bundle price<input name="bundlePrice" type="number" min="0" step="0.01"></label></div><div class="form-two"><label>Happy hour start<input name="startTime" type="time"></label><label>Happy hour end<input name="endTime" type="time"></label></div><label class="check"><input name="auto" type="checkbox" checked> Auto-apply when eligible</label><button class="btn primary">Create</button></form>`);const rule=document.getElementById('promoRule');rule.onchange=()=>{document.getElementById('discountFields').hidden=rule.value==='bundle';document.getElementById('bundleFields').hidden=rule.value!=='bundle';};document.getElementById('promoForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const payload={name:f.get('name'),code:f.get('code')||null,rule_type:f.get('rule'),discount_type:f.get('type')||'fixed',discount_value:Number(f.get('value'))||0,bundle_qty:Number(f.get('bundleQty'))||null,bundle_price:Number(f.get('bundlePrice'))||null,start_time:f.get('startTime')||null,end_time:f.get('endTime')||null,auto_apply:f.get('auto')==='on'};const {error}=await supabase.from('promotions').insert(payload);if(error)return toast(error.message,'error');document.querySelector('.modal-backdrop')?.remove();toast('Promotion created','success');renderPromotions();};};
}

async function renderCustomers(){
  const view=document.getElementById('view'); view.innerHTML=`<section class="management-page"><div class="section-head"><div><p class="eyebrow">Loyalty</p><h1>Customers</h1><p>Customer profiles and reward points.</p></div><button id="newCustomer" class="btn primary">Add customer</button></div><div id="customerTable" class="table-card"><div class="empty-state">Loading…</div></div></section>`;
  const {data,error}=await supabase.from('customers').select('*').order('created_at',{ascending:false}).limit(200); document.getElementById('customerTable').innerHTML=error?`<div class="empty-state">${escapeHtml(error.message)}</div>`:`<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Points</th></tr></thead><tbody>${(data||[]).map(r=>`<tr><td><strong>${escapeHtml(r.name||'Customer')}</strong></td><td>${escapeHtml(r.phone||'—')}</td><td>${escapeHtml(r.email||'—')}</td><td>${Number(r.points||0)}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('newCustomer').onclick=()=>{modal(`<form id="customerForm" class="form-stack"><div><p class="eyebrow">Loyalty</p><h2>Add customer</h2></div><label>Name<input name="name"></label><label>Phone<input name="phone"></label><label>Email<input name="email" type="email"></label><button class="btn primary">Save</button></form>`);document.getElementById('customerForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const {error}=await supabase.from('customers').insert({name:f.get('name')||null,phone:f.get('phone')||null,email:f.get('email')||null});if(error)return toast(error.message,'error');document.querySelector('.modal-backdrop')?.remove();toast('Customer added','success');renderCustomers();};};
}

function renderProducts() {
  const view =
    document.getElementById(
      'view'
    );

  view.innerHTML = `
    <section class="management-page">

      <div class="section-head">

        <div>
          <p class="eyebrow">
            Catalog
          </p>

          <h1>
            Products
          </h1>

          <p>
            Manage menu items and recipes.
          </p>
        </div>

        <button
          id="newProduct"
          class="btn primary"
        >
          + New product
        </button>

      </div>

      <div class="split-management">

        <div class="table-card">

          <table>

            <thead>

              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
                <th></th>
              </tr>

            </thead>

            <tbody>

              ${state.products
                .map(
                  (product) => `
                    <tr>

                      <td>
                        <strong>
                          ${escapeHtml(
                            product.name
                          )}
                        </strong>

                        <small>
                          ${escapeHtml(
                            product.sku ||
                              ''
                          )}
                        </small>
                      </td>

                      <td>
                        ${escapeHtml(
                          product.category ||
                            '—'
                        )}
                      </td>

                      <td>
                        ${money.format(
                          Number(
                            product.price
                          )
                        )}
                      </td>

                      <td>
                        <span
                          class="status ${
                            product.active
                              ? 'on'
                              : 'off'
                          }"
                        >
                          ${
                            product.active
                              ? 'Active'
                              : 'Inactive'
                          }
                        </span>
                      </td>

                      <td>
                        <button
                          class="btn ghost small"
                          data-edit-product="${
                            product.id
                          }"
                        >
                          Edit
                        </button>
                      </td>

                    </tr>
                  `
                )
                .join('')}

            </tbody>

          </table>

        </div>

        <div
          id="productEditor"
          class="editor-card"
        >

          <div class="empty-state">
            Select a product or create a new one.
          </div>

        </div>

      </div>

    </section>
  `;

  document.getElementById(
    'newProduct'
  ).onclick = () =>
    openProductEditor(null);

  document
    .querySelectorAll(
      '[data-edit-product]'
    )
    .forEach((button) => {
      button.onclick = () =>
        openProductEditor(
          button.dataset.editProduct
        );
    });
}

function openProductEditor(id) {
  const product =
    id
      ? state.products.find(
          (item) =>
            item.id === id
        )
      : null;

  state.editingProductId = id;

  const recipes =
    new Map(
      state.recipes
        .filter(
          (recipe) =>
            recipe.product_id ===
            id
        )
        .map(
          (recipe) => [
            recipe.ingredient_id,
            recipe.quantity_required
          ]
        )
    );

  const editor =
    document.getElementById(
      'productEditor'
    );

  editor.innerHTML = `
    <form
      id="productForm"
      class="form-stack"
    >

      <h2>
        ${
          product
            ? 'Edit product'
            : 'New product'
        }
      </h2>

      <label>
        Name

        <input
          name="name"
          required
          value="${escapeHtml(
            product?.name ||
              ''
          )}"
        >
      </label>

      <label>
        SKU

        <input
          name="sku"
          value="${escapeHtml(
            product?.sku ||
              ''
          )}"
        >
      </label>

      <div class="form-two">

        <label>
          Category

          <input
            name="category"
            value="${escapeHtml(
              product?.category ||
                'Drinks'
            )}"
          >
        </label>

        <label>
          Price (RM)

          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            value="${
              product?.price ??
              ''
            }"
          >
        </label>

      </div>

      <label>
        Description

        <textarea
          name="description"
          rows="2"
        >${escapeHtml(
          product?.description ||
            ''
        )}</textarea>
      </label>

      <label class="check">

        <input
          name="active"
          type="checkbox"
          ${
            product?.active !== false
              ? 'checked'
              : ''
          }
        >

        Active on POS

      </label>

      <hr>

      <h3>
        Recipe per item
      </h3>

      <p class="muted">
        Used to deduct ingredient stock automatically after each sale.
      </p>

      <div class="recipe-list">

        ${
          state.ingredients
            .filter(
              (ingredient) =>
                ingredient.active
            )
            .map(
              (ingredient) => `
                <label>

                  <span>
                    ${escapeHtml(
                      ingredient.name
                    )}
                    <small>
                      (${escapeHtml(
                        ingredient.unit
                      )})
                    </small>
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    data-recipe="${
                      ingredient.id
                    }"
                    value="${
                      recipes.get(
                        ingredient.id
                      ) ?? 0
                    }"
                  >

                </label>
              `
            )
            .join('') ||
          `
            <p class="muted">
              Add ingredients in Inventory first.
            </p>
          `
        }

      </div>

      <button
        class="btn primary"
        type="submit"
      >
        Save product
      </button>

    </form>
  `;

  document.getElementById(
    'productForm'
  ).onsubmit =
    saveProduct;
}

async function saveProduct(event) {
  event.preventDefault();

  const formData =
    new FormData(
      event.target
    );

  const product = {
    name:
      formData
        .get('name')
        .trim(),

    sku:
      formData
        .get('sku')
        .trim() || null,

    category:
      formData
        .get('category')
        .trim() || null,

    price:
      Number(
        formData.get(
          'price'
        )
      ),

    description:
      formData
        .get('description')
        .trim() || null,

    active:
      formData.get(
        'active'
      ) === 'on'
  };

  try {
    let id =
      state.editingProductId;

    if (id) {
      const { error } =
        await supabase
          .from('products')
          .update(product)
          .eq('id', id);

      if (error) {
        throw error;
      }
    } else {
      const {
        data,
        error
      } =
        await supabase
          .from('products')
          .insert(product)
          .select('id')
          .single();

      if (error) {
        throw error;
      }

      id = data.id;
    }

    const recipeRows = [
      ...document.querySelectorAll(
        '[data-recipe]'
      )
    ]
      .map(
        (element) => ({
          product_id: id,
          ingredient_id:
            element.dataset.recipe,
          quantity_required:
            Number(
              element.value
            )
        })
      )
      .filter(
        (recipe) =>
          recipe.quantity_required >
          0
      );

    const {
      error: deleteError
    } =
      await supabase
        .from(
          'product_ingredients'
        )
        .delete()
        .eq('product_id', id);

    if (deleteError) {
      throw deleteError;
    }

    if (recipeRows.length) {
      const {
        error: insertError
      } =
        await supabase
          .from(
            'product_ingredients'
          )
          .insert(recipeRows);

      if (insertError) {
        throw insertError;
      }
    }

    await loadCoreData();

    toast(
      'Product saved',
      'success'
    );

    renderProducts();
  } catch (error) {
    console.error(error);

    toast(
      error.message ||
        'Could not save product',
      'error'
    );
  }
}

function renderInventory() {
  const view =
    document.getElementById(
      'view'
    );

  view.innerHTML = `
    <section class="management-page">

      <div class="section-head">

        <div>

          <p class="eyebrow">
            Stock
          </p>

          <h1>
            Ingredient inventory
          </h1>

          <p>
            Track ingredients used by your recipes.
          </p>

        </div>

        <button
          id="newIngredient"
          class="btn primary"
        >
          + New ingredient
        </button>

      </div>

      <div class="inventory-grid">

        ${
          state.ingredients
            .map(
              (ingredient) => {
                const quantity =
                  Number(
                    ingredient
                      .inventory
                      ?.quantity ||
                      0
                  );

                const reorder =
                  Number(
                    ingredient
                      .inventory
                      ?.reorder_level ||
                      0
                  );

                const low =
                  quantity <= reorder;

                return `
                  <article
                    class="inventory-card ${
                      low
                        ? 'low'
                        : ''
                    }"
                  >

                    <div>

                      <span
                        class="status ${
                          low
                            ? 'off'
                            : 'on'
                        }"
                      >
                        ${
                          low
                            ? 'Low stock'
                            : 'In stock'
                        }
                      </span>

                      <h3>
                        ${escapeHtml(
                          ingredient.name
                        )}
                      </h3>

                      <p>
                        ${quantity}
                        ${escapeHtml(
                          ingredient.unit
                        )}
                        on hand
                      </p>

                      <small>
                        Reorder at
                        ${reorder}
                        ${escapeHtml(
                          ingredient.unit
                        )}
                      </small>

                    </div>

                    <button
                      class="btn ghost small"
                      data-stock="${
                        ingredient.id
                      }"
                    >
                      Adjust stock
                    </button>

                  </article>
                `;
              }
            )
            .join('') ||
          `
            <div class="empty-state">
              No ingredients yet.
            </div>
          `
        }

      </div>

    </section>
  `;

  document.getElementById(
    'newIngredient'
  ).onclick =
    openIngredientModal;

  document
    .querySelectorAll(
      '[data-stock]'
    )
    .forEach((button) => {
      button.onclick = () =>
        openStockModal(
          button.dataset.stock
        );
    });
}

function modal(html) {
  const wrap =
    document.createElement(
      'div'
    );

  wrap.className =
    'modal-backdrop';

  wrap.innerHTML = `
    <div class="modal">
      ${html}
    </div>
  `;

  document.body.appendChild(
    wrap
  );

  wrap.onclick = (event) => {
    if (event.target === wrap) {
      wrap.remove();
    }
  };

  return wrap;
}

function openIngredientModal() {
  const modalElement = modal(`
    <form
      id="ingredientForm"
      class="form-stack"
    >

      <div class="section-head">

        <h2>
          New ingredient
        </h2>

        <button
          type="button"
          class="icon-btn"
          id="closeModal"
        >
          ×
        </button>

      </div>

      <label>
        Name

        <input
          name="name"
          required
          placeholder="Watermelon syrup"
        >
      </label>

      <label>
        Unit

        <input
          name="unit"
          required
          placeholder="ml, g, pcs"
        >
      </label>

      <label>
        Opening stock

        <input
          name="quantity"
          type="number"
          min="0"
          step="0.001"
          value="0"
          required
        >
      </label>

      <label>
        Reorder level

        <input
          name="reorder"
          type="number"
          min="0"
          step="0.001"
          value="0"
          required
        >
      </label>

      <button
        class="btn primary"
      >
        Create ingredient
      </button>

    </form>
  `);

  modalElement.querySelector(
    '#closeModal'
  ).onclick = () =>
    modalElement.remove();

  modalElement.querySelector(
    '#ingredientForm'
  ).onsubmit =
    async (event) => {
      event.preventDefault();

      const formData =
        new FormData(
          event.target
        );

      try {
        const {
          data,
          error
        } =
          await supabase
            .from(
              'ingredients'
            )
            .insert({
              name:
                formData
                  .get('name')
                  .trim(),

              unit:
                formData
                  .get('unit')
                  .trim(),

              active: true
            })
            .select('id')
            .single();

        if (error) {
          throw error;
        }

        const {
          error:
            inventoryError
        } =
          await supabase
            .from(
              'ingredient_inventory'
            )
            .insert({
              ingredient_id:
                data.id,

              outlet_id:
                state.staff
                  .outlet_id,

              quantity:
                Number(
                  formData.get(
                    'quantity'
                  )
                ),

              reorder_level:
                Number(
                  formData.get(
                    'reorder'
                  )
                )
            });

        if (inventoryError) {
          throw inventoryError;
        }

        await loadCoreData();

        modalElement.remove();

        toast(
          'Ingredient created',
          'success'
        );

        renderInventory();
      } catch (error) {
        toast(
          error.message,
          'error'
        );
      }
    };
}

function openStockModal(id) {
  const item =
    state.ingredients.find(
      (ingredient) =>
        ingredient.id === id
    );

  const modalElement = modal(`
    <form
      id="stockForm"
      class="form-stack"
    >

      <div class="section-head">

        <h2>
          ${escapeHtml(
            item.name
          )}
        </h2>

        <button
          type="button"
          class="icon-btn"
          id="closeModal"
        >
          ×
        </button>

      </div>

      <p>
        Current:
        <strong>
          ${Number(
            item.inventory
              ?.quantity ||
              0
          )}
          ${escapeHtml(
            item.unit
          )}
        </strong>
      </p>

      <label>
        Adjustment

        <input
          name="delta"
          type="number"
          step="0.001"
          required
          placeholder="e.g. 500 or -50"
        >
      </label>

      <label>
        Note

        <input
          name="note"
          required
          placeholder="Restock / wastage / correction"
        >
      </label>

      <button
        class="btn primary"
      >
        Apply adjustment
      </button>

    </form>
  `);

  modalElement.querySelector(
    '#closeModal'
  ).onclick = () =>
    modalElement.remove();

  modalElement.querySelector(
    '#stockForm'
  ).onsubmit =
    async (event) => {
      event.preventDefault();

      const formData =
        new FormData(
          event.target
        );

      const { error } =
        await supabase.rpc(
          'adjust_ingredient_stock',
          {
            p_ingredient_id:
              id,

            p_delta:
              Number(
                formData.get(
                  'delta'
                )
              ),

            p_note:
              formData
                .get('note')
                .trim()
          }
        );

      if (error) {
        return toast(
          error.message,
          'error'
        );
      }

      await loadCoreData();

      modalElement.remove();

      toast(
        'Stock updated',
        'success'
      );

      renderInventory();
    };
}

async function renderReports() {
  const view =
    document.getElementById(
      'view'
    );

  view.innerHTML = `
    <section class="management-page">

      <div class="section-head">

        <div>

          <p class="eyebrow">
            Performance
          </p>

          <h1>
            Today
          </h1>

        </div>

      </div>

      <div class="metrics">

        <div class="metric-card">
          <span>Sales</span>
          <strong id="rSales">
            —
          </strong>
        </div>

        <div class="metric-card">
          <span>
            Transactions
          </span>

          <strong id="rTx">
            —
          </strong>
        </div>

        <div class="metric-card">
          <span>
            Average order
          </span>

          <strong id="rAvg">
            —
          </strong>
        </div>

      </div>

      <div class="table-card">

        <table>

          <thead>

            <tr>
              <th>Receipt</th>
              <th>Time</th>
              <th>Staff</th>
              <th>Payment</th>
              <th>Total</th>
            </tr>

          </thead>

          <tbody id="salesRows">

            <tr>
              <td colspan="5">
                Loading…
              </td>
            </tr>

          </tbody>

        </table>

      </div>

    </section>
  `;

  const start =
    new Date();

  start.setHours(
    0,
    0,
    0,
    0
  );

  const {
    data,
    error
  } =
    await supabase
      .from('sales')
      .select(
        'receipt_number,created_at,total,payment_method,staff(name)'
      )
      .eq(
        'outlet_id',
        state.staff.outlet_id
      )
      .gte(
        'created_at',
        start.toISOString()
      )
      .order(
        'created_at',
        {
          ascending: false
        }
      );

  if (error) {
    toast(
      error.message,
      'error'
    );

    return;
  }

  const total =
    (data || []).reduce(
      (sum, sale) =>
        sum +
        Number(
          sale.total
        ),
      0
    );

  document.getElementById(
    'rSales'
  ).textContent =
    money.format(total);

  document.getElementById(
    'rTx'
  ).textContent =
    (data || []).length;

  document.getElementById(
    'rAvg'
  ).textContent =
    money.format(
      data?.length
        ? total /
            data.length
        : 0
    );

  document.getElementById(
    'salesRows'
  ).innerHTML =
    (data || [])
      .map(
        (sale) => `
          <tr>

            <td>
              ${escapeHtml(
                sale.receipt_number
              )}
            </td>

            <td>
              ${new Date(
                sale.created_at
              ).toLocaleTimeString(
                'en-MY',
                {
                  hour:
                    '2-digit',
                  minute:
                    '2-digit'
                }
              )}
            </td>

            <td>
              ${escapeHtml(
                sale.staff?.name ||
                  ''
              )}
            </td>

            <td>
              ${escapeHtml(
                sale.payment_method
              )}
            </td>

            <td>
              ${money.format(
                Number(
                  sale.total
                )
              )}
            </td>

          </tr>
        `
      )
      .join('') ||
    `
      <tr>
        <td colspan="5">
          No sales today.
        </td>
      </tr>
    `;
}

async function logout() {
  await supabase.auth.signOut();

  state.authUser = null;
  state.staff = null;
  state.cart.clear();

  renderLogin();
}

function renderFatal(message) {
  app.innerHTML = `
    <main class="login-page">

      <section class="login-card">

        <h1>
          POS could not start
        </h1>

        <p>
          ${escapeHtml(message)}
        </p>

        <button
          class="btn primary"
          onclick="location.reload()"
        >
          Reload
        </button>

      </section>

    </main>
  `;
}
