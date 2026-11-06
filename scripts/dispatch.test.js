// Run after `npm run build`: node --test scripts/
process.env.ASAP_WEBHOOK_SECRET = "s3cret";
process.env.NO_DRIVER_MAX_RETRIES = "3";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

function mock(path, exports) { require.cache[require.resolve(path)] = { exports }; }

const orders = new Map();
const calls = { retries: [], transfers: [], messages: [], ratings: [] };
let assignFails = null;
const base = { id: 7, user_id: 111, vendor_id: 9, status: "paid", subtotal: 5000, delivery_fee: 1000,
  ride_type: "ASAPEXPRESS", order_ref: "ref-1", asap_status: null, asap_status_at: null, no_driver_retries: 0,
  driver_id: null, driver_name: null, driver_phone: null, driver_account_number: null, driver_bank_code: null,
  pickup_code: null, dropoff_code: null, vendor_paid_at: null, driver_paid_at: null };
const reset = () => { orders.clear(); orders.set("ref-1", { ...base }); for (const k in calls) calls[k] = []; assignFails = null; };

mock("../dist/src/db/queries", {
  async getOrderByRef(ref) { const o = orders.get(ref); return o ? { ...o } : null; },
  async applyOrderStatus(ref, status, at) {
    const o = orders.get(ref);
    if (!o || (o.asap_status_at && !(o.asap_status_at < at))) return null;
    Object.assign(o, { asap_status: status, asap_status_at: at });
    if (status === "delivered") o.status = "delivered";
    if (status === "cancelled") o.status = "cancelled";
    if (status === "in_transit") o.status = "in_progress";
    return { ...o };
  },
  async countNoDriverRetry(id, n) { for (const o of orders.values()) if (o.id === id) o.no_driver_retries = n; },
  async saveRideDetails(ref, d) { Object.assign(orders.get(ref), d); },
  async claimPayout(id, who) { const o = [...orders.values()].find(o => o.id === id); if (o[`${who}_paid_at`]) return false; o[`${who}_paid_at`] = "now"; return true; },
  async releasePayout(id, who) { [...orders.values()].find(o => o.id === id)[`${who}_paid_at`] = null; },
  async getVendorPayout() { return { name: "Vendor", user_id: 222, acct_details: { bank_account_number: "0001", bank_code: "058" } }; },
});
class AsapError extends Error { constructor(status, m) { super(m); this.status = status; } }
mock("../dist/src/api/asap", {
  AsapError,
  async assignDriver(ref) { calls.retries.push(ref); if (assignFails) throw new AsapError(assignFails, "refused"); return { status: "success" }; },
  async preflight() { return {}; }, async requestRide() { return {}; },
});
mock("../dist/src/api/payment/paystackTransfer", { async transferTo(...a) { calls.transfers.push(a); } });
mock("../dist/src/telegram/registry", { getVendorBot() { return { async sendMessage(to, text) { calls.messages.push({ to, text }); } }; } });
mock("../dist/src/telegram/handlers", { async sendRatingPrompt(_b, to) { calls.ratings.push(to); } });

const express = require("express");
const app = express(); app.use(express.json()); app.use(require("../dist/src/api/rides").default);
const server = http.createServer(app);
const ready = new Promise(r => server.listen(0, r));
const settle = () => new Promise(r => setTimeout(r, 30));

async function post(path, body, secret = "s3cret") {
  await ready;
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-asap-secret": secret } : {}) },
    body: JSON.stringify(body) });
  await settle();
  return res.status;
}
const status = (s, at) => ({ order_ref: "ref-1", order_code: "ZZ-1", status: s, driver_id: null, updated_at: at });
const details = (driverId, pick = "482913", drop = "771045") => ({ order_ref: "ref-1", status: "arriving_pickup",
  pick_up: { code: pick }, drop_off: { code: drop },
  driver: { driver_id: driverId, name: "Ade", phone: "+234800", vehicle_type: "Bike", account_number: "123", bank_code: "044" } });

test("rejects a missing or wrong secret", async () => {
  reset();
  assert.equal(await post("/order-status", status("no_driver", "2026-10-11T14:00:00Z"), null), 401);
  assert.equal(await post("/ride-details", details("d1"), "nope"), 401);
  assert.equal(calls.retries.length, 0);
});

test("no_driver retries via assign-driver and ignores older or repeated pushes", async () => {
  reset();
  assert.equal(await post("/order-status", status("no_driver", "2026-10-11T14:00:00Z")), 200);
  assert.deepEqual(calls.retries, ["ref-1"]);
  assert.equal(await post("/order-status", status("no_driver", "2026-10-11T14:00:00Z")), 200); // repeat
  assert.equal(await post("/order-status", status("no_driver", "2026-10-11T13:00:00Z")), 200); // older
  assert.deepEqual(calls.retries, ["ref-1"]);
  await post("/order-status", status("no_driver", "2026-10-11T14:05:00Z"));
  assert.equal(calls.retries.length, 2);
  assert.equal(calls.messages.filter(m => /still searching/.test(m.text)).length, 1);
});

test("stops after NO_DRIVER_MAX_RETRIES and survives a refused retry", async () => {
  reset();
  assignFails = 409;
  for (let i = 1; i <= 4; i++) await post("/order-status", status("no_driver", `2026-10-11T14:0${i}:00Z`));
  assert.equal(calls.retries.length, 3);
  assert.ok(calls.messages.some(m => /couldn't find a driver/.test(m.text)));
});

test("ride-details stores backend codes, tells customer and vendor; repeats are quiet", async () => {
  reset();
  assert.equal(await post("/ride-details", details("d1")), 200);
  const o = orders.get("ref-1");
  assert.equal(o.pickup_code, "482913"); assert.equal(o.dropoff_code, "771045"); assert.equal(o.driver_account_number, "123");
  assert.ok(calls.messages.some(m => m.to === 111 && /771045/.test(m.text) && !/482913/.test(m.text)));
  assert.ok(calls.messages.some(m => m.to === 222 && /482913/.test(m.text)));
  const n = calls.messages.length;
  await post("/ride-details", details("d1"));
  assert.equal(calls.messages.length, n);
  await post("/ride-details", details("d2"));
  assert.ok(calls.messages.slice(n).some(m => /new driver/i.test(m.text)));
  assert.equal(await post("/ride-details", { order_ref: "ref-1" }), 400);
});

test("delivered pays vendor and driver once, then asks for a rating", async () => {
  reset();
  await post("/ride-details", details("d1"));
  await post("/order-status", status("in_transit", "2026-10-11T14:10:00Z"));
  assert.equal(orders.get("ref-1").status, "in_progress");
  await post("/order-status", status("delivered", "2026-10-11T14:20:00Z"));
  await post("/order-status", status("delivered", "2026-10-11T14:21:00Z")); // a newer duplicate
  assert.equal(calls.transfers.length, 2);
  const [vendor, driver] = [calls.transfers.find(t => /vendor/.test(t[4])), calls.transfers.find(t => /driver/.test(t[4]))];
  assert.equal(vendor[3], 5000); assert.equal(driver[3], 800); assert.equal(driver[1], "123");
  assert.deepEqual(calls.ratings, [111, 111]);
});

test("ride-details after delivery is ignored; driver-arrived reads order_ref", async () => {
  reset();
  await post("/order-status", status("cancelled", "2026-10-11T14:00:00Z"));
  await post("/ride-details", details("d1"));
  assert.equal(orders.get("ref-1").driver_id, null);
  reset();
  await post("/ride-details", details("d1"));
  assert.equal(await post("/driver-arrived", { order_ref: "ref-1", driver_lat: 6.4, driver_lng: 3.4 }), 200);
  assert.ok(calls.messages.some(m => /almost there/.test(m.text) && /771045/.test(m.text)));
  assert.equal(await post("/driver-arrived", { order_id: 7 }), 400);
});

test.after(() => server.close());
