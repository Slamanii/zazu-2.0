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
const views = { menu: $("view-menu"), cart: $("view-cart"), track: $("view-track") }
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
const headerTrack = $("header-track")
const headerLocation = $("header-location")
const trackContent = $("track-content")
const locationOverlay = $("location-overlay")
const locationMap = $("location-map")
const locationClose = $("location-close")
const locationUseTg = $("location-use-tg")
const locationRemove = $("location-remove")
const locationError = $("location-error")
const locationSaveBtn = $("location-save-btn")


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
const VIEW_ORDER = ["menu", "cart", "track"]
let currentView = "menu"

function showView(name) {
  if (!views[name]) return
  const fromIdx = VIEW_ORDER.indexOf(currentView)
  const toIdx = VIEW_ORDER.indexOf(name)
  const goingForward = toIdx > fromIdx
  currentView = name

  for (const [key, view] of Object.entries(views)) {
    if (key === name) {
      // Set the off-screen starting position for the transition
      if (goingForward) view.classList.add("slide-from-right")
      // else: view already sits at translateX(-100%) (the .view default)
      // Force reflow so the browser commits the starting position
      view.getBoundingClientRect()
      // Remove slide-from-right before adding active so only .view.active
      // controls the final transform (avoids CSS specificity conflict)
      view.classList.remove("slide-from-right")
      view.classList.add("active")
    } else {
      view.classList.remove("active")
      // Outgoing view: set it up to slide away correctly on next show
      if (VIEW_ORDER.indexOf(key) < toIdx) {
        view.classList.remove("slide-from-right")
      } else {
        view.classList.add("slide-from-right")
      }
    }
  }

  const notMenu = name !== "menu"
  backBtn.style.display = notMenu ? "block" : "none"
  if (tg) notMenu ? tg.BackButton.show() : tg.BackButton.hide()
  if (name === "cart") renderCart()
  if (name === "track") loadActiveOrder()
  updateCartFab()
  window.scrollTo(0, 0)
}

backBtn.addEventListener("click", () => showView("menu"))
tg?.BackButton.onClick(() => {
  if (!locationOverlay.hidden) {
    closeLocationOverlay()
  } else {
    showView("menu")
  }
})
cartFab.addEventListener("click", () => showView("cart"))
headerCart.addEventListener("click", () => showView("cart"))
headerTrack.addEventListener("click", () => showView("track"))
headerLocation.addEventListener("click", () => openLocationOverlay())

// ── Location overlay ─────────────────────────────────────
let pendingLat = null
let pendingLng = null
let gMap = null
let gMarker = null
let googleMapsApiKey = null
let mapsLoaded = false

async function openLocationOverlay() {
  locationOverlay.hidden = false
  locationError.textContent = ""
  if (tg) tg.BackButton.show()
  await initLocationMap()
}

function closeLocationOverlay() {
  locationOverlay.hidden = true
  if (currentView === "menu" && tg) tg.BackButton.hide()
}

locationClose.addEventListener("click", closeLocationOverlay)

async function ensureMapsKey() {
  if (googleMapsApiKey !== null) return googleMapsApiKey
  try {
    const res = await fetch(`${API_BASE}/webapp/config`)
    if (res.ok) googleMapsApiKey = (await res.json()).googleMapsApiKey ?? ""
  } catch {}
  return googleMapsApiKey
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

function updatePin(lat, lng) {
  pendingLat = lat
  pendingLng = lng
  locationSaveBtn.disabled = false
  haptic()
  if (!gMap) return
  const pos = { lat, lng }
  if (gMarker) {
    gMarker.setPosition(pos)
  } else {
    gMarker = new google.maps.Marker({ position: pos, map: gMap, draggable: true })
    gMarker.addListener("dragend", (e) => updatePin(e.latLng.lat(), e.latLng.lng()))
  }
  gMap.panTo(pos)
}

function clearPin() {
  pendingLat = null
  pendingLng = null
  locationSaveBtn.disabled = true
  if (gMarker) { gMarker.setMap(null); gMarker = null }
}

async function initLocationMap() {
  locationSaveBtn.disabled = true
  locationError.textContent = ""
  pendingLat = null
  pendingLng = null

  let savedLat = null, savedLng = null
  if (tg?.initData) {
    try {
      const res = await fetch(`${API_BASE}/webapp/user/location?vendorId=${vendorId}&initData=${encodeURIComponent(tg.initData)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.lat && data.lng) {
          savedLat = Number(data.lat)
          savedLng = Number(data.lng)
        }
      }
    } catch {}
  }

  if (!gMap) {
    const key = await ensureMapsKey()
    if (!key) {
      locationError.textContent = "Map unavailable — Maps API key not configured."
      return
    }
    if (!window.google?.maps) {
      try {
        await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`)
      } catch {
        locationError.textContent = "Could not load Google Maps."
        return
      }
    }
    const center = savedLat ? { lat: savedLat, lng: savedLng } : { lat: 6.5244, lng: 3.3792 }
    gMap = new google.maps.Map(locationMap, {
      center,
      zoom: savedLat ? 15 : 13,
      disableDefaultUI: false,
      clickableIcons: false,
    })
    gMap.addListener("click", (e) => updatePin(e.latLng.lat(), e.latLng.lng()))
    if (savedLat) {
      gMarker = new google.maps.Marker({ position: center, map: gMap, draggable: true })
      gMarker.addListener("dragend", (e) => updatePin(e.latLng.lat(), e.latLng.lng()))
      pendingLat = savedLat
      pendingLng = savedLng
      locationSaveBtn.disabled = false
    }
  } else if (savedLat) {
    gMap.setCenter({ lat: savedLat, lng: savedLng })
    if (!gMarker) {
      gMarker = new google.maps.Marker({ position: { lat: savedLat, lng: savedLng }, map: gMap, draggable: true })
      gMarker.addListener("dragend", (e) => updatePin(e.latLng.lat(), e.latLng.lng()))
    }
    pendingLat = savedLat
    pendingLng = savedLng
    locationSaveBtn.disabled = false
  }
}

locationUseTg.addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => updatePin(pos.coords.latitude, pos.coords.longitude),
      () => { locationError.textContent = "Could not get your location." }
    )
  } else {
    locationError.textContent = "Location not supported on this device."
  }
})

locationRemove.addEventListener("click", () => {
  clearPin()
  haptic()
})

locationSaveBtn.addEventListener("click", async () => {
  if (pendingLat === null || pendingLng === null) return
  if (!tg?.initData) {
    locationError.textContent = "Open this menu from the store's bot to save your location."
    return
  }
  locationSaveBtn.disabled = true
  locationError.textContent = ""
  try {
    const res = await fetch(`${API_BASE}/webapp/user/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, initData: tg.initData, lat: pendingLat, lng: pendingLng }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || "Could not save location")
    haptic("medium")
    closeLocationOverlay()
  } catch (err) {
    locationError.textContent = err.message
    locationSaveBtn.disabled = false
  }
})

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
    renderChips()
    renderMenu()
  } catch {
    statusMessage("Could not load the menu. Please check your connection and try again.")
    return
  }
  await loadServerCart()
  startCartPolling()
  checkForActiveOrder()
}

async function checkForActiveOrder() {
  // Track button is always visible; this is a no-op kept for future use.
}

// ── Shared cart ─────────────────────────────────────────
const SAVE_DELAY_MS = 400
const POLL_MS = 4000
let localVersion = 0
let savedVersion = 0
let saveTimer = null
let saving = false

function findItem(id) {
  for (const cat of categories) {
    const item = cat.items.find((i) => i.id === id)
    if (item) return item
  }
  return null
}

const cartLines = () => [...cart.values()].map(({ item, qty }) => ({ itemId: item.id, qty }))
const sameLines = (a, b) =>
  a.length === b.length && a.every((l) => b.some((m) => m.itemId === l.itemId && m.qty === l.qty))

function applyServerCart(lines) {
  if (sameLines(lines, cartLines())) return
  cart.clear()
  for (const { itemId, qty } of lines) {
    const item = findItem(itemId)
    if (item) cart.set(item.id, { item, qty })
  }
  renderMenu()
  if (views.cart.classList.contains("active")) renderCart()
  updateCartFab()
}

async function cartRequest(path, extra = {}) {
  if (!tg?.initData) return null
  const res = await fetch(`${API_BASE}/webapp/cart/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendorId, initData: tg.initData, ...extra }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error || "Could not reach your cart"), { status: res.status })
  return body
}

async function loadServerCart() {
  if (saving || saveTimer || localVersion !== savedVersion) return
  try {
    const body = await cartRequest("state")
    if (body && localVersion === savedVersion && !saving && !saveTimer) applyServerCart(body.items)
  } catch {}
}

function scheduleSave() {
  localVersion++
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveCart, SAVE_DELAY_MS)
}

async function saveCart() {
  saveTimer = null
  if (saving) { saveTimer = setTimeout(saveCart, SAVE_DELAY_MS); return }
  const version = localVersion
  saving = true
  try {
    const body = await cartRequest("sync", { items: cartLines() })
    savedVersion = version
    if (body && version === localVersion) applyServerCart(body.items)
  } catch (err) {
    savedVersion = version
    cartError.textContent = err.message
    if (err.status === 409) { await loadMenu() }
  } finally {
    saving = false
  }
}

let pollTimer = null
function startCartPolling() {
  if (pollTimer || !tg?.initData) return
  pollTimer = setInterval(() => { if (!document.hidden) loadServerCart() }, POLL_MS)
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadServerCart() })
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
    return statusMessage(term ? `Nothing matches "${search.value.trim()}".` : "Nothing in this category yet.")
  }
  menuList.replaceChildren(el("div", { class: "item-grid", role: "tabpanel" }, items.map(itemCard)))
}

function itemCard(item) {
  const inStock = item.stock > 0
  const qty = cart.get(item.id)?.qty ?? 0
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
  const card = menuList.querySelector(`[data-item="${item.id}"]`)
  if (card) card.replaceWith(itemCard(item))
  if (views.cart.classList.contains("active")) renderCart()
  updateCartFab()
  scheduleSave()
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
  const onMenu = currentView === "menu"
  cartFabCount.textContent = count
  cartFabTotal.textContent = naira(total)
  cartFab.classList.toggle("visible", onMenu && count > 0)
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
  clearTimeout(saveTimer)
  saveTimer = null
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
    tg.close()
  } catch (err) {
    cartError.textContent = err.message
    loadMenu()
  } finally {
    savedVersion = localVersion
    submitting = false
    checkoutBtn.disabled = !cart.size
    checkoutBtn.textContent = "Continue to checkout"
  }
}

// ── Order tracking ──────────────────────────────────────
const TRACK_STEPS = [
  { key: "pending",    icon: "🛒", label: "Order placed" },
  { key: "paid",       icon: "💳", label: "Payment confirmed" },
  { key: "dispatched", icon: "🚴", label: "Rider assigned" },
  { key: "in_transit", icon: "🛵", label: "On the way" },
  { key: "delivered",  icon: "✅", label: "Delivered" },
]

function statusLabel(asapStatus, status) {
  if (asapStatus === "in_transit") return "in_transit"
  if (status === "delivered") return "delivered"
  if (status === "dispatched" || asapStatus) return "dispatched"
  if (status === "paid") return "paid"
  return "pending"
}

async function loadActiveOrder() {
  if (!tg?.initData) {
    trackContent.replaceChildren(el("p", { class: "track-no-order" }, "Open this menu from the store's bot to track orders."))
    return
  }
  trackContent.replaceChildren(el("p", { class: "status-msg" }, "Loading your order…"))
  try {
    const res = await fetch(`${API_BASE}/webapp/order/active?vendorId=${vendorId}&initData=${encodeURIComponent(tg.initData)}`)
    if (!res.ok) throw new Error(String(res.status))
    const { order } = await res.json()
    if (!order) {
      trackContent.replaceChildren(el("p", { class: "track-no-order" }, "No active order right now."))
      return
    }
    const current = statusLabel(order.asap_status, order.status)
    const stepIdx = TRACK_STEPS.findIndex(s => s.key === current)
    const steps = TRACK_STEPS.map((s, i) => {
      const done = i < stepIdx
      const active = i === stepIdx
      return el("div", { class: `track-step${done ? " done" : active ? " active" : ""}` },
        el("span", { class: "track-icon" }, s.icon),
        el("div", {},
          el("div", { class: "track-label" }, s.label),
        ),
      )
    })
    const nodes = [el("div", { class: "track-status" }, steps)]

    if (order.driver_name || order.driver_phone) {
      nodes.push(el("div", { class: "track-driver" },
        el("h3", {}, "Your rider"),
        order.driver_name ? el("p", {}, order.driver_name) : null,
        order.driver_phone
          ? el("p", {}, el("a", { href: `tel:${order.driver_phone}` }, order.driver_phone))
          : null,
      ))
    }
    if (order.dropoff_code) {
      nodes.push(el("div", { class: "track-driver" },
        el("h3", {}, "Drop-off code"),
        el("p", { class: "track-code" }, order.dropoff_code),
        el("p", {}, "Show this to the rider when your order arrives."),
      ))
    }
    trackContent.replaceChildren(...nodes)
  } catch {
    trackContent.replaceChildren(el("p", { class: "status-msg" }, "Could not load order status."))
  }
}

loadMenu()
