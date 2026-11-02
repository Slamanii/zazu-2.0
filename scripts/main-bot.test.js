const {test}=require("node:test");
const assert=require("node:assert/strict");
const {EventEmitter}=require("node:events");
function mock(path,exports){require.cache[require.resolve(path)]={exports};}
let fail=false;
mock("../dist/src/db/supabase",{supabase:{from(table){const q={select(){return this},eq(){return Promise.resolve({data:[{vendor_id:1,bot_id:"vendor_test_bot",bot_link:"https://t.me/vendor_test_bot"}],error:fail?{}:null})},in(){return this},order(){return this},limit(){return this},ilike(){return this},then(resolve){return Promise.resolve({data:[{id:1,name:"Test Vendor"}],error:null}).then(resolve)}};return q;}}});
mock("../dist/src/db/queries",{});
mock("../dist/src/api/payment/paystack",{});
const {attachMainHandlers}=require("../dist/src/telegram/zazu_main_client");
test("main commands respond and search links to vendor",async()=>{
 const commands=[],sent=[];
 const bot=new EventEmitter(); bot.onText=(pattern,handler)=>commands.push({pattern,handler}); bot.sendMessage=async(...args)=>sent.push(args);
 attachMainHandlers(bot);
 async function send(text){const command=commands.find(c=>c.pattern.test(text));assert.ok(command);await command.handler({chat:{id:123},text},text.match(command.pattern));}
 await send("/start");assert.match(sent.at(-1)[1],/Welcome to Zazu Marketplace/);
 await send("/help");assert.match(sent.at(-1)[1],/search/);
 await send("/search");assert.equal(sent.at(-1)[2].reply_markup.inline_keyboard[0][0].url,"https://t.me/vendor_test_bot");
 fail=true;await send("/search pizza");assert.match(sent.at(-1)[1],/temporarily unavailable/);
});
