// ── Config ──────────────────────────────────────────────
const API_BASE = window.location.origin

// ── Telegram SDK ────────────────────────────────────────
const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand()
}

// ── State ───────────────────────────────────────────────
let menuData = []   // array of categories with items
let cart = {}       // { itemId: { name, price, qty } }

// ── DOM refs ────────────────────────────────────────────
const views = {
  categories: document.getElementById("view-categories"),
  items:      document.getElementById("view-items"),
  cart:       document.getElementById("view-cart"),
}
const categoryList  = document.getElementById("category-list")
const itemList      = document.getElementById("item-list")
const cartList      = document.getElementById("cart-list")
const cartTotal     = document.getElementById("cart-total")
const headerTitle   = document.getElementById("header-title")
const backBtn       = document.getElementById("back-btn")
const cartFab       = document.getElementById("cart-fab")
const cartFabCount  = document.getElementById("cart-fab-count")

// ── Navigation ──────────────────────────────────────────
function showView(name, title, showBack) {
  Object.values(views).forEach(v => v.classList.remove("active"))
  views[name].classList.add("active")
  headerTitle.textContent = title
  backBtn.style.display = showBack ? "block" : "none"
}

backBtn.addEventListener("click", () => showView("categories", "Menu", false))

cartFab.addEventListener("click", () => {
  renderCart()
  showView("cart", "Cart", true)
})

// ── Fetch menu ──────────────────────────────────────────
async function loadMenu() {
  try {
    const res = await fetch(`${API_BASE}/menu`, {
      headers: { "ngrok-skip-browser-warning": "true" }
    })
    menuData = await res.json()
    renderCategories()
  } catch (e) {
    categoryList.innerHTML = `<p class="loading">Could not load menu.</p>`
  }
}

// ── Render categories ───────────────────────────────────
function renderCategories() {
  categoryList.innerHTML = ""
  if (!menuData.length) {
    categoryList.innerHTML = `<p class="loading">No categories found.</p>`
    return
  }
  menuData.forEach(cat => {
    const card = document.createElement("div")
    card.className = "category-card"
    card.textContent = cat.name
    card.addEventListener("click", () => openCategory(cat))
    categoryList.appendChild(card)
  })
}

// ── Render items ─────────────────────────────────────────
function openCategory(cat) {
  itemList.innerHTML = ""
  cat.item.forEach(item => {
    const inStock = item.stock > 0
    const card = document.createElement("div")
    card.className = "item-card"
    card.innerHTML = `
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-price">₦${item.price}</div>
        <div class="item-stock">${inStock ? `${item.stock} in stock` : "Out of stock"}</div>
      </div>
      <button class="add-btn" ${!inStock ? "disabled" : ""}>Add</button>
    `
    card.querySelector(".add-btn").addEventListener("click", () => addToCart(item))
    itemList.appendChild(card)
  })
  showView("items", cat.name, true)
}

// ── Cart logic ───────────────────────────────────────────
function addToCart(item) {
  if (cart[item.id]) {
    cart[item.id].qty += 1
  } else {
    cart[item.id] = { name: item.name, price: item.price, qty: 1 }
  }
  updateCartFab()
  if (tg) tg.HapticFeedback?.impactOccurred("light")
}

function updateCartFab() {
  const total = Object.values(cart).reduce((s, i) => s + i.qty, 0)
  cartFabCount.textContent = total
  total > 0 ? cartFab.classList.add("visible") : cartFab.classList.remove("visible")
}

function renderCart() {
  cartList.innerHTML = ""
  const items = Object.entries(cart)

  if (!items.length) {
    cartList.innerHTML = `<p class="empty-msg">Your cart is empty</p>`
    cartTotal.textContent = ""
    hideMainButton()
    return
  }

  let total = 0
  items.forEach(([id, item]) => {
    total += item.price * item.qty
    const el = document.createElement("div")
    el.className = "cart-item"
    el.innerHTML = `
      <div class="cart-item-top">
        <span class="cart-item-name">${item.name}</span>
        <span class="cart-item-subtotal">₦${item.price * item.qty}</span>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn" data-id="${id}" data-action="dec">−</button>
        <span class="qty-label">${item.qty}</span>
        <button class="qty-btn" data-id="${id}" data-action="inc">+</button>
        <button class="remove-btn" data-id="${id}" data-action="remove">Remove</button>
      </div>
    `
    cartList.appendChild(el)
  })

  cartTotal.textContent = `Total: ₦${total}`
  showMainButton(total)

  cartList.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id
      const action = btn.dataset.action
      if (action === "inc") cart[id].qty += 1
      if (action === "dec") {
        cart[id].qty -= 1
        if (cart[id].qty <= 0) delete cart[id]
      }
      if (action === "remove") delete cart[id]
      updateCartFab()
      renderCart()
    })
  })
}

// ── Telegram Main Button ─────────────────────────────────
function showMainButton(total) {
  if (!tg) return
  tg.MainButton.text = `Checkout  ₦${total}`
  tg.MainButton.show()
  tg.MainButton.onClick(handleCheckout)
}

function hideMainButton() {
  if (!tg) return
  tg.MainButton.hide()
}

function handleCheckout() {
  const items = Object.entries(cart).map(([id, item]) => ({
    itemId: id,
    name: item.name,
    price: item.price,
    qty: item.qty,
  }))
  if (tg) {
    tg.sendData(JSON.stringify({ action: "checkout", items }))
  }
}

// ── Init ─────────────────────────────────────────────────
loadMenu()
