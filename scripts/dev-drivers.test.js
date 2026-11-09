// Run after `npm run build`: node --test scripts/dev-drivers.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
function mock(path, exports) { require.cache[require.resolve(path)] = { exports }; }

let rows = [];
mock("../dist/src/db/supabase", { supabase: { from() {
  let pending = null;
  const q = {
    select() { return q; }, order() { return q; },
    like(_, pat) { q.filter = (r) => r.email && r.email.startsWith("fake-rider-") && r.email.endsWith("@dev.local"); return q; },
    async limit() { return { data: rows.filter(q.filter ?? (() => true)), error: null }; },
    update(fields) { pending = fields; return q; },
    async eq(_, id) { Object.assign(rows.find((r) => r.driver_id === id), pending); return { error: null }; },
    async insert(row) { rows.push(row); return { error: null }; },
  };
  return q;
} } });
const { ensureFakeDriversNear } = require("../dist/src/db/queries");

const km = (a, b) => {
  const r = (d) => (d * Math.PI) / 180, R = 6371;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

test("places 3 available EV drivers within 5 km and reuses them", async () => {
  rows = [{ driver_id: "real", email: "real@driver.ng", status: "busy", vehicle_type: "Bike" }];
  const store = { lat: 6.7376, lng: 6.2202 };
  await ensureFakeDriversNear(store.lat, store.lng, "EV");
  let fakes = rows.filter((r) => r.email.endsWith("@dev.local"));
  assert.equal(fakes.length, 3);
  for (const f of fakes) {
    assert.equal(f.status, "available"); assert.equal(f.vehicle_type, "EV");
    assert.ok(km(store, f.driver_location) < 5, "inside the backend's 5 km rider check");
  }
  // A second order elsewhere moves the same three; a real driver is never touched.
  fakes.forEach((f) => (f.status = "busy"));
  const elsewhere = { lat: 6.5244, lng: 3.3792 };
  await ensureFakeDriversNear(elsewhere.lat, elsewhere.lng, "Bike");
  fakes = rows.filter((r) => r.email.endsWith("@dev.local"));
  assert.equal(fakes.length, 3);
  for (const f of fakes) {
    assert.equal(f.status, "available"); assert.equal(f.vehicle_type, "Bike");
    assert.ok(km(elsewhere, f.driver_location) < 5);
  }
  assert.deepEqual(rows[0], { driver_id: "real", email: "real@driver.ng", status: "busy", vehicle_type: "Bike" });
});
