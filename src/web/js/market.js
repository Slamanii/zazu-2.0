// The Zazu main bot's marketplace: every vendor with an active bot. Tapping one opens that
// vendor's bot with ?start=menu, which greets the customer with a button to its web menu.

const API_BASE = window.location.origin
const tg = window.Telegram?.WebApp
if (tg) {
  tg.ready()
  tg.expand()
}

const list = document.getElementById("vendor-list")
const search = document.getElementById("vendor-search")

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value)
    else if (value != null) node.setAttribute(key, value)
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function status(text) {
  list.replaceChildren(el("p", { class: "status-msg" }, text))
}

function openVendor(link) {
  tg?.HapticFeedback?.impactOccurred("light")
  // openTelegramLink switches to the vendor's bot inside Telegram.
  if (tg?.openTelegramLink) tg.openTelegramLink(link)
  else window.location.href = link
}

function vendorCard(v) {
  const tags = []
  if (v.open_now === true) tags.push(el("span", { class: "tag open" }, "Open now"))
  if (v.open_now === false) tags.push(el("span", { class: "tag closed" }, `Closed · opens ${String(v.open_time).slice(0, 5)}`))
  if (v.rating?.count) tags.push(el("span", { class: "tag" }, `⭐ ${v.rating.average} (${v.rating.count})`))

  return el("button", { class: "vendor-card", onclick: () => openVendor(v.link) },
    el("span", { class: "vendor-avatar", "aria-hidden": "true" }, (v.name.trim()[0] || "?").toUpperCase()),
    el("span", { class: "vendor-info" },
      el("span", { class: "vendor-name" }, v.name),
      v.address ? el("span", { class: "vendor-address" }, v.address) : null,
      tags.length ? el("span", { class: "vendor-tags" }, tags) : null,
    ),
    el("span", { class: "vendor-go", "aria-hidden": "true" }, "›"),
  )
}

let latest = 0
async function load(term = "") {
  const ticket = ++latest
  try {
    const res = await fetch(`${API_BASE}/webapp/vendors?q=${encodeURIComponent(term)}`)
    if (!res.ok) throw new Error(String(res.status))
    const { vendors } = await res.json()
    if (ticket !== latest) return // a newer search already answered
    if (!vendors.length) {
      status(term ? `No stores match “${term}”.` : "No stores are available right now. Please check back soon.")
      return
    }
    // Open stores first, then by name.
    vendors.sort((a, b) => (b.open_now === true) - (a.open_now === true) || a.name.localeCompare(b.name))
    list.replaceChildren(...vendors.map(vendorCard))
  } catch {
    if (ticket === latest) status("Could not load stores. Please check your connection and try again.")
  }
}

let timer
search.addEventListener("input", () => {
  clearTimeout(timer)
  timer = setTimeout(() => load(search.value.trim()), 250)
})

load()
