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
};

const roleRank = { cashier: 1, manager: 2, owner: 3 };
const canManage = () => roleRank[state.staff?.role] >= roleRank.manager;

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
  const [productsRes, ingredientsRes, recipesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id,name,sku,description,category,price,active')
      .order('category')
      .order('name'),

    supabase
      .from('ingredients')
      .select(
        'id,name,unit,active,ingredient_inventory(quantity,reorder_level,outlet_id)'
      )
      .order('name'),

    supabase
      .from('product_ingredients')
      .select('product_id,ingredient_id,quantity_required')
  ]);

  if (productsRes.error) {
    throw productsRes.error;
  }

  if (
    ingredientsRes.error &&
    ingredientsRes.error.code !== '42P01'
  ) {
    throw ingredientsRes.error;
  }

  if (
    recipesRes.error &&
    recipesRes.error.code !== '42P01'
  ) {
    throw recipesRes.error;
  }

  state.products = productsRes.data || [];

  state.ingredients = (ingredientsRes.data || []).map((ingredient) => ({
    ...ingredient,
    inventory:
      (ingredient.ingredient_inventory || []).find(
        (inventory) => inventory.outlet_id === state.staff.outlet_id
      ) || null
  }));

  state.recipes = recipesRes.data || [];
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

function renderShell() {
  if (
    !canManage() &&
    ['products', 'inventory', 'reports'].includes(
      state.activeView
    )
  ) {
    state.activeView = 'pos';
  }

  app.innerHTML = `
    <div class="app-shell">

      <header class="topbar">

        <div class="brand-lockup">
          <img src="./logo.jpg" alt="">

          <div>
            <strong>Watermelon Soda</strong>
            <small>
              ${escapeHtml(state.outlet?.name || 'Outlet')}
            </small>
          </div>
        </div>

        <nav
          class="main-nav"
          aria-label="Main navigation"
        >

          <button
            data-view="pos"
            class="nav-link ${
              state.activeView === 'pos'
                ? 'active'
                : ''
            }"
          >
            POS
          </button>

          ${
            canManage()
              ? `
                <button
                  data-view="products"
                  class="nav-link ${
                    state.activeView === 'products'
                      ? 'active'
                      : ''
                  }"
                >
                  Products
                </button>

                <button
                  data-view="inventory"
                  class="nav-link ${
                    state.activeView === 'inventory'
                      ? 'active'
                      : ''
                  }"
                >
                  Inventory
                </button>

                <button
                  data-view="reports"
                  class="nav-link ${
                    state.activeView === 'reports'
                      ? 'active'
                      : ''
                  }"
                >
                  Reports
                </button>
              `
              : ''
          }

        </nav>

        <div class="user-box">

          <div>
            <strong>
              ${escapeHtml(state.staff.name)}
            </strong>

            <small>
              ${escapeHtml(state.staff.role)}
            </small>
          </div>

          <button
            id="logoutBtn"
            class="btn ghost small"
          >
            Log out
          </button>

        </div>

      </header>

      <main id="view"></main>

    </div>
  `;

  document
    .querySelectorAll('[data-view]')
    .forEach((button) => {
      button.onclick = () => {
        state.activeView = button.dataset.view;
        renderShell();
      };
    });

  document.getElementById('logoutBtn').onclick =
    logout;

  renderActiveView();
}

function renderActiveView() {
  if (state.activeView === 'products') {
    return renderProducts();
  }

  if (state.activeView === 'inventory') {
    return renderInventory();
  }

  if (state.activeView === 'reports') {
    return renderReports();
  }

  return renderPOS();
}

function renderPOS() {
  const view = document.getElementById('view');

  const categories = [
    ...new Set(
      state.products
        .filter((product) => product.active)
        .map(
          (product) =>
            product.category || 'Drinks'
        )
    )
  ];

  view.innerHTML = `
    <section class="pos-layout">

      <div class="catalog-panel">

        <div class="section-head">

          <div>
            <p class="eyebrow">Sell</p>
            <h1>New order</h1>
          </div>

          <input
            id="productSearch"
            class="search"
            placeholder="Search products"
          >

        </div>

        <div class="category-strip">

          <button
            class="chip active"
            data-category="all"
          >
            All
          </button>

          ${categories
            .map(
              (category) => `
                <button
                  class="chip"
                  data-category="${escapeHtml(
                    category
                  )}"
                >
                  ${escapeHtml(category)}
                </button>
              `
            )
            .join('')}

        </div>

        <div
          id="productGrid"
          class="product-grid"
        ></div>

      </div>

      <aside class="cart-panel">

        <div class="section-head">

          <div>
            <p class="eyebrow">
              Current order
            </p>

            <h2>Cart</h2>
          </div>

          <button
            id="clearCart"
            class="btn ghost small"
          >
            Clear
          </button>

        </div>

        <div
          id="cartItems"
          class="cart-items"
        ></div>

        <div class="cart-footer">

          <div class="payment-row">

            <button
              class="pay-btn ${
                state.paymentMethod === 'cash'
                  ? 'active'
                  : ''
              }"
              data-pay="cash"
            >
              Cash
            </button>

            <button
              class="pay-btn ${
                state.paymentMethod === 'card'
                  ? 'active'
                  : ''
              }"
              data-pay="card"
            >
              Card terminal
            </button>

            <button
              class="pay-btn ${
                state.paymentMethod === 'qr'
                  ? 'active'
                  : ''
              }"
              data-pay="qr"
            >
              DuitNow QR
            </button>

          </div>

          <div class="grand-total">

            <span>Total</span>

            <strong id="cartTotal">
              RM0.00
            </strong>

          </div>

          <button
            id="checkoutBtn"
            class="btn primary checkout"
          >
            Complete sale
          </button>

        </div>

      </aside>

    </section>
  `;

  renderProductGrid('all', '');
  renderCart();

  let activeCategory = 'all';

  document
    .querySelectorAll('[data-category]')
    .forEach((button) => {
      button.onclick = () => {
        document
          .querySelectorAll('[data-category]')
          .forEach((item) =>
            item.classList.remove('active')
          );

        button.classList.add('active');

        activeCategory =
          button.dataset.category;

        renderProductGrid(
          activeCategory,
          document.getElementById(
            'productSearch'
          ).value
        );
      };
    });

  document.getElementById(
    'productSearch'
  ).oninput = (event) =>
    renderProductGrid(
      activeCategory,
      event.target.value
    );

  document
    .querySelectorAll('[data-pay]')
    .forEach((button) => {
      button.onclick = () => {
        state.paymentMethod =
          button.dataset.pay;

        document
          .querySelectorAll('[data-pay]')
          .forEach((item) =>
            item.classList.toggle(
              'active',
              item.dataset.pay ===
                state.paymentMethod
            )
          );
      };
    });

  document.getElementById(
    'clearCart'
  ).onclick = () => {
    state.cart.clear();
    renderCart();
  };

  document.getElementById(
    'checkoutBtn'
  ).onclick = checkout;
}

function renderProductGrid(
  category = 'all',
  search = ''
) {
  const grid =
    document.getElementById('productGrid');

  if (!grid) {
    return;
  }

  const query =
    search.trim().toLowerCase();

  const products =
    state.products.filter((product) => {
      const matchesCategory =
        category === 'all' ||
        (product.category || 'Drinks') ===
          category;

      const matchesSearch =
        !query ||
        `${product.name} ${
          product.sku || ''
        }`
          .toLowerCase()
          .includes(query);

      return (
        product.active &&
        matchesCategory &&
        matchesSearch
      );
    });

  grid.innerHTML = products.length
    ? products
        .map(
          (product) => `
            <button
              class="product-card"
              data-product="${product.id}"
            >

              <span class="product-category">
                ${escapeHtml(
                  product.category ||
                    'Drinks'
                )}
              </span>

              <strong>
                ${escapeHtml(product.name)}
              </strong>

              <span>
                ${money.format(
                  Number(product.price)
                )}
              </span>

            </button>
          `
        )
        .join('')
    : `
        <div class="empty-state">
          No products found.
        </div>
      `;

  grid
    .querySelectorAll('[data-product]')
    .forEach((button) => {
      button.onclick = () =>
        addToCart(
          button.dataset.product
        );
    });
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
  const lines = [
    ...state.cart.entries()
  ]
    .map(([id, quantity]) => ({
      product:
        state.products.find(
          (product) =>
            product.id === id
        ),
      quantity
    }))
    .filter(
      (item) => item.product
    );

  const total =
    lines.reduce(
      (sum, item) =>
        sum +
        Number(
          item.product.price
        ) *
          item.quantity,
      0
    );

  return {
    lines,
    total
  };
}

function renderCart() {
  const box =
    document.getElementById(
      'cartItems'
    );

  if (!box) {
    return;
  }

  const { lines, total } =
    cartSummary();

  box.innerHTML = lines.length
    ? lines
        .map(
          ({
            product,
            quantity
          }) => `
            <div class="cart-line">

              <div>
                <strong>
                  ${escapeHtml(
                    product.name
                  )}
                </strong>

                <small>
                  ${money.format(
                    Number(
                      product.price
                    )
                  )} each
                </small>
              </div>

              <div class="qty-control">

                <button
                  data-minus="${
                    product.id
                  }"
                >
                  −
                </button>

                <span>
                  ${quantity}
                </span>

                <button
                  data-plus="${
                    product.id
                  }"
                >
                  +
                </button>

              </div>

              <strong>
                ${money.format(
                  Number(
                    product.price
                  ) * quantity
                )}
              </strong>

            </div>
          `
        )
        .join('')
    : `
        <div class="empty-state compact">
          Tap a product to start an order.
        </div>
      `;

  document.getElementById(
    'cartTotal'
  ).textContent =
    money.format(total);

  box
    .querySelectorAll('[data-minus]')
    .forEach((button) => {
      button.onclick = () =>
        changeQty(
          button.dataset.minus,
          -1
        );
    });

  box
    .querySelectorAll('[data-plus]')
    .forEach((button) => {
      button.onclick = () =>
        changeQty(
          button.dataset.plus,
          1
        );
    });
}

async function checkout() {
  const { lines } =
    cartSummary();

  if (!lines.length) {
    return toast(
      'Add at least one product',
      'error'
    );
  }

  const button =
    document.getElementById(
      'checkoutBtn'
    );

  button.disabled = true;
  button.textContent =
    'Processing…';

  try {
    const payload =
      lines.map((item) => ({
        product_id:
          item.product.id,
        quantity:
          item.quantity
      }));

    const { data, error } =
      await supabase.rpc(
        'complete_pos_sale',
        {
          p_payment_method:
            state.paymentMethod,
          p_items: payload
        }
      );

    if (error) {
      throw error;
    }

    const sale =
      Array.isArray(data)
        ? data[0]
        : data;

    state.cart.clear();

    toast(
      `Sale completed • ${sale.receipt_number}`,
      'success'
    );

    renderPOS();

    printReceiptWindow(sale);
  } catch (error) {
    console.error(error);

    toast(
      error.message ||
        'Sale failed',
      'error'
    );

    button.disabled = false;
    button.textContent =
      'Complete sale';
  }
}

function printReceiptWindow(sale) {
  const windowRef =
    window.open(
      '',
      '_blank',
      'width=420,height=720'
    );

  if (!windowRef) {
    return;
  }

  windowRef.document.write(`
    <html>

      <head>

        <title>
          ${escapeHtml(
            sale.receipt_number
          )}
        </title>

        <style>

          body {
            font-family: system-ui;
            padding: 24px;
            color: #111;
          }

          h1 {
            font-size: 20px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          td {
            padding: 7px 0;
            border-bottom: 1px solid #ddd;
          }

          .r {
            text-align: right;
          }

          .total {
            font-size: 20px;
            font-weight: 800;
          }

        </style>

      </head>

      <body>

        <h1>
          Watermelon Soda
        </h1>

        <p>
          ${escapeHtml(
            state.outlet?.name ||
              ''
          )}
        </p>

        <p>
          ${escapeHtml(
            sale.receipt_number
          )}
          <br>
          ${new Date().toLocaleString(
            'en-MY'
          )}
        </p>

        <table>

          ${sale.items
            .map(
              (item) => `
                <tr>

                  <td>
                    ${escapeHtml(
                      item.product_name
                    )}
                    ×
                    ${item.quantity}
                  </td>

                  <td class="r">
                    ${money.format(
                      Number(
                        item.subtotal
                      )
                    )}
                  </td>

                </tr>
              `
            )
            .join('')}

          <tr class="total">

            <td>Total</td>

            <td class="r">
              ${money.format(
                Number(
                  sale.total
                )
              )}
            </td>

          </tr>

        </table>

        <p>
          Payment:
          ${escapeHtml(
            state.paymentMethod.toUpperCase()
          )}
        </p>

        <p>
          Thank you!
        </p>

        <script>
          window.onload = () => window.print()
        <\/script>

      </body>

    </html>
  `);

  windowRef.document.close();
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
