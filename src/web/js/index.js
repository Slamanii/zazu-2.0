// A vendor's web menu, opened from that vendor's Telegram bot (Menu button or /menu).
// The bot puts the vendor in the URL: index.html?vendorId=12
// Checkout sends the chosen items and Telegram's signed initData to /webapp/cart; the server
// checks the signature, prices the items from the database and sends the cart to the chat.

const API_BASE = window.location.origin
const vendorId = Number(new URLSearchParams(window.location.search).get("vendorId"))

const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand()
}

// ── State ───────────────────────────────────────────────
let categories = []   // [{ id, name, items: [{ id, name, price, stock, image_url }] }]
const cart = new Map() // itemId -> { item, qty }
let submitting = false

// ── DOM ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const views = { menu: $("view-menu"), cart: $("view-cart") }
const storeName = $("store-name")
const storeMeta = $("store-meta")
const backBtn = $("back-btn")
const search = $("menu-search")
const chips = $("category-chips")
const menuList = $("menu-list")
const cartList = $("cart-list")
const cartTotal = $("cart-total")
const cartError = $("cart-error")
const checkoutBtn = $("checkout-btn")
const cartFab = $("cart-fab")
const cartFabCount = $("cart-fab-count")
const cartFabTotal = $("cart-fab-total")
const headerCart = $("header-cart")
const headerCartCount = $("header-cart-count")

// The category tabs stick just under the header, whose height depends on the store's name.
const header = document.querySelector(".store-header")
function syncHeaderHeight() {
  document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`)
}
window.addEventListener("resize", syncHeaderHeight)

// Builds an element. Text always goes in as text, never as HTML: names come from vendors.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value)
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value)
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

const naira = (n) => "₦" + Number(n).toLocaleString("en-NG")

function haptic(kind = "light") {
  tg?.HapticFeedback?.impactOccurred(kind)
}

function statusMessage(text) {
  menuList.replaceChildren(el("p", { class: "status-msg" }, text))
}

// ── Navigation ──────────────────────────────────────────
function showView(name) {
  for (const [key, view] of Object.entries(views)) view.classList.toggle("active", key === name)
  const inCart = name === "cart"
  backBtn.style.display = inCart && !tg ? "block" : "none"
  if (tg) inCart ? tg.BackButton.show() : tg.BackButton.hide()
  if (inCart) renderCart()
  updateCartFab()
  window.scrollTo(0, 0)
}

backBtn.addEventListener("click", () => showView("menu"))
tg?.BackButton.onClick(() => showView("menu"))
cartFab.addEventListener("click", () => showView("cart"))
headerCart.addEventListener("click", () => showView("cart"))

// ── Load ────────────────────────────────────────────────
async function loadMenu() {
  if (!vendorId) {
    statusMessage("This menu link is missing its store. Please open it from the store's bot.")
    return
  }
  try {
    const res = await fetch(`${API_BASE}/webapp/vendor?vendorId=${vendorId}`)
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    categories = data.categories
    renderHeader(data.vendor)
    syncHeaderHeight()
    renderChips()
    renderMenu()
  } catch {
    statusMessage("Could not load the menu. Please check your connection and try again.")
  }
}

function renderHeader(vendor) {
  storeName.textContent = vendor.name
  document.title = vendor.name
  const parts = []
  if (vendor.open_now === true) parts.push("🟢 Open now")
  if (vendor.open_now === false) parts.push(`🔴 Closed · opens ${String(vendor.open_time).slice(0, 5)}`)
  if (vendor.rating?.count) parts.push(`⭐ ${vendor.rating.average} (${vendor.rating.count})`)
  storeMeta.textContent = parts.join("  ·  ")
}

// ── Menu ────────────────────────────────────────────────
// One category at a time: the tabs switch between them. A search looks across all of them.
let activeTab = null

function renderChips() {
  if (!categories.some((c) => c.id === activeTab)) activeTab = categories[0]?.id ?? null
  const searching = search.value.trim() !== ""
  chips.replaceChildren(...categories.map((cat) => {
    const active = !searching && cat.id === activeTab
    return el("button", {
      class: `chip${active ? " active" : ""}`,
      role: "tab",
      "aria-selected": active ? "true" : "false",
      onclick: (e) => {
        activeTab = cat.id
        if (searching) search.value = ""
        haptic()
        renderChips()
        renderMenu()
        e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
        window.scrollTo(0, 0)
      },
    }, cat.name)
  }))
  chips.style.display = categories.length > 1 ? "" : "none"
}

function renderMenu() {
  if (!categories.length) return statusMessage("This store hasn't added anything to its menu yet.")
  const term = search.value.trim().toLowerCase()
  const items = term
    ? categories.flatMap((cat) => cat.items).filter((i) => i.name.toLowerCase().includes(term))
    : categories.find((cat) => cat.id === activeTab)?.items ?? []

  if (!items.length) {
    return statusMessage(term ? `Nothing matches “${search.value.trim()}”.` : "Nothing in this category yet.")
  }
  menuList.replaceChildren(el("div", { class: "item-grid", role: "tabpanel" }, items.map(itemCard)))
}

function itemCard(item) {
  const inStock = item.stock > 0
  const qty = cart.get(item.id)?.qty ?? 0
  // No photo, or one that fails to load: the item's first letter stands in.
  const placeholder = () => el("div", { class: "item-photo placeholder", "aria-hidden": "true" }, (item.name.trim()[0] || "?").toUpperCase())
  const photo = item.image_url
    ? el("img", { class: "item-photo", src: item.image_url, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(placeholder()) })
    : placeholder()
  const control = !inStock
    ? el("span", { class: "sold-out" }, "Sold out")
    : qty === 0
      ? el("button", { class: "add-btn", onclick: () => changeQty(item, 1) }, "Add")
      : stepper(item, qty)

  return el("article", { class: `item-card${inStock ? "" : " is-sold-out"}`, "data-item": item.id },
    photo,
    el("div", { class: "item-info" },
      el("h3", { class: "item-name" }, item.name),
      el("p", { class: "item-price" }, naira(item.price)),
      inStock && item.stock <= 5 ? el("p", { class: "item-stock" }, `Only ${item.stock} left`) : null,
    ),
    el("div", { class: "item-action" }, control),
  )
}

function stepper(item, qty) {
  return el("div", { class: "stepper" },
    el("button", { class: "step-btn", "aria-label": `Remove one ${item.name}`, onclick: () => changeQty(item, -1) }, "−"),
    el("span", { class: "step-qty" }, qty),
    el("button", {
      class: "step-btn",
      "aria-label": `Add one ${item.name}`,
      disabled: qty >= item.stock,
      onclick: () => changeQty(item, 1),
    }, "+"),
  )
}

search.addEventListener("input", () => { renderChips(); renderMenu() })

// ── Cart ────────────────────────────────────────────────
function changeQty(item, delta) {
  const qty = Math.min(item.stock, (cart.get(item.id)?.qty ?? 0) + delta)
  if (qty <= 0) cart.delete(item.id)
  else cart.set(item.id, { item, qty })
  haptic()
  cartError.textContent = ""
  // Redraw just this item, and the cart if it is open.
  const card = menuList.querySelector(`[data-item="${item.id}"]`)
  if (card) card.replaceWith(itemCard(item))
  if (views.cart.classList.contains("active")) renderCart()
  updateCartFab()
}

function cartTotals() {
  let count = 0
  let total = 0
  for (const { item, qty } of cart.values()) {
    count += qty
    total += item.price * qty
  }
  return { count, total }
}

function updateCartFab() {
  const { count, total } = cartTotals()
  const onMenu = views.menu.classList.contains("active")
  cartFabCount.textContent = count
  cartFabTotal.textContent = naira(total)
  cartFab.classList.toggle("visible", onMenu && count > 0)
  // The header cart sits top right on the menu; in the cart, back takes its place.
  headerCart.style.display = onMenu ? "" : "none"
  headerCartCount.textContent = count
  headerCartCount.classList.toggle("empty", count === 0)
}

function renderCart() {
  const lines = [...cart.values()]
  const { total } = cartTotals()
  cartTotal.textContent = naira(total)
  checkoutBtn.disabled = !lines.length || submitting

  if (!lines.length) {
    cartList.replaceChildren(el("p", { class: "status-msg" }, "Your order is empty."))
    return
  }
  cartList.replaceChildren(...lines.map(({ item, qty }) =>
    el("div", { class: "cart-line" },
      el("div", { class: "cart-line-info" },
        el("span", { class: "cart-line-name" }, item.name),
        el("span", { class: "cart-line-price" }, naira(item.price * qty)),
      ),
      stepper(item, qty),
    ),
  ))
}

checkoutBtn.addEventListener("click", checkout)

async function checkout() {
  if (submitting || !cart.size) return
  if (!tg?.initData) {
    cartError.textContent = "Open this menu from the store's Telegram bot to place an order."
    return
  }
  submitting = true
  checkoutBtn.disabled = true
  checkoutBtn.textContent = "Sending…"
  cartError.textContent = ""
  try {
    const res = await fetch(`${API_BASE}/webapp/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        initData: tg.initData,
        items: [...cart.values()].map(({ item, qty }) => ({ itemId: item.id, qty })),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || "Could not send your order, please try again.")
    haptic("medium")
    // The bot has sent the cart to the chat, where checkout continues.
    tg.close()
  } catch (err) {
    cartError.textContent = err.message
    // Stock may have changed; reload it so the menu shows what's left.
    loadMenu()
  } finally {
    submitting = false
    checkoutBtn.disabled = !cart.size
    checkoutBtn.textContent = "Continue to checkout"
  }
}

loadMenu()
