const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
let rows = [], failure = false;
const made = [];
class FakeBot extends EventEmitter {
  constructor(token) { super(); this.token = token; made.push(this); }
  async getMe() { if (this.token.endsWith("invalid")) throw Error("invalid"); return {id: Number(this.token.split(":")[0]), username: "managed"}; }
  async setMyCommands() {}
  async startPolling() { this.started = true; }
  async stopPolling() { this.stopped = true; }
}
function mock(path, exports) { require.cache[require.resolve(path)] = { exports }; }
mock("node-telegram-bot-api", FakeBot);
mock("../dist/src/db/supabase", {supabase: {from() {return {select() {return this}, order() {return this}, async range() {return {data: rows, error: failure ? {code: "denied"} : null}}}}}});
mock("../dist/src/telegram/zazu_vendor_acct", {attachVendorHandlers(bot, vendor) { bot.vendor = vendor; }});
mock("../dist/src/telegram/zazu_main_client", {attachMainHandlers(bot) {bot.main = true;}});
const registry = require("../dist/src/telegram/registry");
const row = (id, vendor, active = true, token = `${id}:valid`) => ({id, bot_id:id, vendor_id: vendor, is_active:active, bot_token:token});
test("managed lifecycle and tenant routing", async () => {
  await assert.rejects(registry.startBotRegistry(), /required/);
  rows = [row(1,10), row(2,20), row(3,null), row(4,40,false), row(5,50,true,"5:invalid")];
  await registry.refreshBots();
  const a = registry.getVendorBot(10), b = registry.getVendorBot(20);
  assert.notEqual(a,b); assert.equal(a.vendor,10); assert.equal(b.vendor,20);
  assert.throws(() => registry.getVendorBot(40)); assert.throws(() => registry.getVendorBot(50));
  const count = made.length;
  rows = [row(1,10),row(2,20)]; await registry.refreshBots(); assert.equal(made.length,count);
  failure = true; await assert.rejects(registry.refreshBots()); assert.equal(registry.getVendorBot(10),a); failure = false;
  rows = [row(1,10,true,"1:rotated"),row(2,20,false)]; await registry.refreshBots();
  assert.equal(a.stopped,true); assert.equal(b.stopped,true); assert.notEqual(registry.getVendorBot(10),a);
  assert.throws(() => registry.getVendorBot(20));
  rows = [row(1,30,true,"1:rotated")]; await registry.refreshBots(); assert.equal(registry.getVendorBot(30).vendor,30); assert.throws(() => registry.getVendorBot(10));
  rows = [{...row(8,80), bot_id:"managed"}]; await registry.refreshBots();
  assert.equal(registry.getVendorBot(80).vendor,80);
  rows = []; await registry.refreshBots(); assert.throws(() => registry.getVendorBot(30));
  await registry.stopBotRegistry();
});
