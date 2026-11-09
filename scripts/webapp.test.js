// Run after `npm run build`: node --test scripts/webapp.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createHmac } = require("node:crypto");

function mock(path, exports) { require.cache[require.resolve(path)] = { exports }; }

const TOKEN = "123456:secret-token";
const calls = { carts: [], summaries: [], edits: [] };
let stored = null; // the customer's cart row, as getCart returns it
const menu = [{ id: 1, name: "Mains", item: [
  { id: 10, name: "Jollof", price: 2500, stock: 3, image_url: null },
  { id: 11, name: "Suya", price: 1500, stock: 0, image_url: null },
] }];
let tables = {};

// A chainable stand-in for the few supabase calls /webapp/vendors and /webapp/vendor make.
function from(table) {
  const q = { rows: tables[table] ?? [], filters: [] };
  const chain = {
    select() { return chain; }, order() { return chain; }, limit() { return chain; },
    eq(k, v) { q.rows = q.rows.filter(r => r[k] === v); return chain; },
    not(k) { q.rows = q.rows.filter(r => r[k] != null); return chain; },
    is(k, v) { q.rows = q.rows.filter(r => (r[k] ?? null) === v); return chain; },
    in(k, vs) { q.rows = q.rows.filter(r => vs.includes(r[k])); return chain; },
    ilike(k, pat) { const t = pat.slice(1, -1).toLowerCase(); q.rows = q.rows.filter(r => r[k].toLowerCase().includes(t)); return chain; },
    async maybeSingle() { return { data: q.rows[0] ?? null, error: null }; },
    then(res, rej) { return Promise.resolve({ data: q.rows, error: null }).then(res, rej); },
  };
  return chain;
}
mock("../dist/src/db/supabase", { supabase: { from } });
mock("../dist/src/db/queries", {
  async getCategoriesWithItems() { return menu; },
  async getVendorAverageRating() { return { average: 4.5, count: 2 }; },
  async upsertCart(...a) { calls.carts.push(a); stored = { items: a[2], total: a[3] }; },
  async getCart() { return stored; },
});
const bot = {};
mock("../dist/src/telegram/registry", {
  getVendorBotEntry: (id) => (id === 9 ? { bot, token: TOKEN } : null),
  // Running vendor bots with their real Telegram usernames. Vendor 7 has a bot but is deleted.
  listVendorBots: () => [{ vendorId: 9, username: "MamaPutBot" }, { vendorId: 7, username: "ClosedBot" }],
});
mock("../dist/src/telegram/handlers", {
  async sendCartSummary(...a) { calls.summaries.push(a); },
  async editCartSummary(...a) { calls.edits.push(a); },
});

const webapp = require("../dist/src/api/webapp");
const express = require("express");
const app = express(); app.use(express.json()); app.use(webapp.default);
const server = http.createServer(app);
const ready = new Promise(r => server.listen(0, r));

function sign(fields, token = TOKEN) {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
const now = () => String(Math.floor(Date.now() / 1000));
const initData = (user = { id: 555, first_name: "Ada" }, auth = now()) =>
  sign({ auth_date: auth, query_id: "q1", user: JSON.stringify(user) });

async function call(method, path, body) {
  await ready;
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

test("verifyInitData accepts Telegram's signature and nothing else", () => {
  assert.equal(webapp.verifyInitData(initData(), TOKEN).id, 555);
  assert.equal(webapp.verifyInitData(initData(), "999:other-bot"), null);           // another bot's token
  const tampered = initData().replace("555", "556");
  assert.equal(webapp.verifyInitData(tampered, TOKEN), null);                        // edited user
  assert.equal(webapp.verifyInitData(initData(undefined, String(Number(now()) - 90000)), TOKEN), null); // too old
  assert.equal(webapp.verifyInitData("", TOKEN), null);
});

test("cart rejects unsigned or foreign-bot data", async () => {
  calls.carts = [];
  let r = await call("POST", "/webapp/cart", { vendorId: 9, initData: "user=%7B%22id%22%3A1%7D&hash=" + "0".repeat(64), items: [{ itemId: 10, qty: 1 }] });
  assert.equal(r.status, 401);
  r = await call("POST", "/webapp/cart", { vendorId: 9, initData: sign({ auth_date: now(), user: '{"id":1}' }, "999:other"), items: [{ itemId: 10, qty: 1 }] });
  assert.equal(r.status, 401);
  r = await call("POST", "/webapp/cart", { vendorId: 8, initData: initData(), items: [{ itemId: 10, qty: 1 }] });
  assert.equal(r.status, 503);
  assert.equal(calls.carts.length, 0);
});

test("cart prices from the database, checks stock, and sends the cart to the chat", async () => {
  calls.carts = []; calls.summaries = [];
  let r = await call("POST", "/webapp/cart", { vendorId: 9, initData: initData(), items: [{ itemId: 10, qty: 4 }] });
  assert.equal(r.status, 409); assert.match(r.body.error, /Only 3 Jollof/);
  r = await call("POST", "/webapp/cart", { vendorId: 9, initData: initData(), items: [{ itemId: 11, qty: 1 }] });
  assert.equal(r.status, 409); assert.match(r.body.error, /out of stock/);
  r = await call("POST", "/webapp/cart", { vendorId: 9, initData: initData(), items: [{ itemId: 99, qty: 1 }] });
  assert.equal(r.status, 409);
  r = await call("POST", "/webapp/cart", { vendorId: 9, initData: initData(), items: [{ itemId: 10, qty: 0 }] });
  assert.equal(r.status, 400);
  assert.equal(calls.carts.length, 0);

  // The page's price is ignored; the item is priced at 2500 from the menu.
  r = await call("POST", "/webapp/cart", { vendorId: 9, initData: initData(), items: [{ itemId: 10, qty: 1, price: 1 }, { itemId: 10, qty: 1 }] });
  assert.equal(r.status, 200); assert.equal(r.body.total, 5000);
  assert.deepEqual(calls.carts[0], [555, 9, [{ itemId: 10, name: "Jollof", price: 2500, qty: 2 }], 5000]);
  assert.deepEqual(calls.summaries[0], [bot, 555, 555, 9]);
});

test("the menu and the chat share one cart", async () => {
  calls.carts = []; calls.summaries = []; calls.edits = []; stored = null;
  // Nothing saved yet: an empty cart.
  let r = await call("POST", "/webapp/cart/state", { vendorId: 9, initData: initData() });
  assert.equal(r.status, 200); assert.deepEqual(r.body.items, []);
  // A change in the chat (already stored) shows up in the menu.
  stored = { items: [{ itemId: 10, name: "Jollof", price: 2500, qty: 2 }], total: 5000 };
  r = await call("POST", "/webapp/cart/state", { vendorId: 9, initData: initData() });
  assert.deepEqual(r.body.items, [{ itemId: 10, qty: 2 }]);
  // A change in the menu is saved, priced from the database, and edits the chat's cart message
  // without sending a new one.
  r = await call("POST", "/webapp/cart/sync", { vendorId: 9, initData: initData(), items: [{ itemId: 10, qty: 3, price: 1 }] });
  assert.equal(r.status, 200); assert.equal(r.body.total, 7500);
  assert.deepEqual(calls.carts.at(-1), [555, 9, [{ itemId: 10, name: "Jollof", price: 2500, qty: 3 }], 7500]);
  assert.deepEqual(calls.edits.at(-1), [bot, 555, 555, 9]);
  assert.equal(calls.summaries.length, 0);
  // Emptying the cart in the menu empties it for the chat too.
  r = await call("POST", "/webapp/cart/sync", { vendorId: 9, initData: initData(), items: [] });
  assert.equal(r.status, 200); assert.deepEqual(stored.items, []);
  // Too many, unsigned, or another bot's signature: refused, nothing saved.
  const before = calls.carts.length;
  assert.equal((await call("POST", "/webapp/cart/sync", { vendorId: 9, initData: initData(), items: [{ itemId: 10, qty: 4 }] })).status, 409);
  assert.equal((await call("POST", "/webapp/cart/state", { vendorId: 9, initData: "user=%7B%22id%22%3A1%7D" })).status, 401);
  assert.equal((await call("POST", "/webapp/cart/sync", { vendorId: 9, initData: sign({ auth_date: now(), user: '{"id":1}' }, "9:x"), items: [] })).status, 401);
  assert.equal(calls.carts.length, before);
});

test("menu and marketplace data", async () => {
  tables = {
    telegram_vendor: [
      { id: 9, name: "Mama Put", address: "Yaba", open_time: "00:00:00", close_time: "00:00:00", deleted_at: null },
      { id: 7, name: "Closed Co", address: "Ikeja", open_time: "08:00:00", close_time: "08:00:00", deleted_at: "2026-01-01" },
    ],
    telegram_bots: [
      { vendor_id: 9, bot_username: "MamaPutBot", bot_link: null, bot_id: "1", is_active: true },
      { vendor_id: 7, bot_username: "ClosedBot", bot_link: null, bot_id: "2", is_active: true },
      { vendor_id: null, bot_username: "ZazuBot", bot_link: null, bot_id: "3", is_active: true },
    ],
  };
  let r = await call("GET", "/webapp/vendor?vendorId=9");
  assert.equal(r.status, 200); assert.equal(r.body.vendor.name, "Mama Put"); assert.equal(r.body.vendor.open_now, true);
  assert.deepEqual(r.body.categories[0].items.map(i => i.name), ["Jollof", "Suya"]);
  assert.equal((await call("GET", "/webapp/vendor?vendorId=7")).status, 404);   // deleted vendor
  assert.equal((await call("GET", "/webapp/vendor?vendorId=abc")).status, 400);

  r = await call("GET", "/webapp/vendors");
  assert.deepEqual(r.body.vendors.map(v => [v.name, v.link]), [["Mama Put", "https://t.me/MamaPutBot?start=menu"]]);
  r = await call("GET", "/webapp/vendors?q=zzz");
  assert.deepEqual(r.body.vendors, []);
});

test.after(() => server.close());
