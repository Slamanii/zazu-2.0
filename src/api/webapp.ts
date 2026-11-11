// Data and actions for the Telegram Mini Apps: each vendor bot's web menu (index.html) and the
// Zazu main marketplace (market.html).
import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "../db/supabase";
import { GOOGLE_MAPS_API_KEY } from "../env";
import { getCart, getCategoriesWithItems, getVendorAverageRating, upsertCart, getUserByTelegramId, upsertUserLocation } from "../db/queries";
import { getVendorBotEntry, listVendorBots } from "../telegram/registry";
import { editCartSummary, sendCartSummary } from "../telegram/handlers";
import { CartItem } from "../types";

const router = Router();

// Telegram signs the data it hands a Mini App (initData) with the token of the bot that opened
// it. Checking that signature is the only way to know who the viewer really is: anything else in
// the request can be made up. https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const MAX_INIT_DATA_AGE_SECS = 24 * 60 * 60;

export function verifyInitData(initData: string, botToken: string, nowSecs = Date.now() / 1000):
  { id: number; first_name?: string; username?: string } | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || nowSecs - authDate > MAX_INIT_DATA_AGE_SECS) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "");
    return Number.isSafeInteger(user?.id) ? user : null;
  } catch {
    return null;
  }
}

// Lagos time, where the vendors are. open_time / close_time are "HH:MM:SS"; a close time before
// the open time means the vendor closes after midnight.
function isOpenNow(open: string | null, close: string | null, now = new Date()): boolean | null {
  if (!open || !close) return null;
  const lagos = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  const minutes = lagos.getHours() * 60 + lagos.getMinutes();
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
  const [o, c] = [toMin(open), toMin(close)];
  if (o === c) return true;
  return o < c ? minutes >= o && minutes < c : minutes >= o || minutes < c;
}

// ---------- Vendor menu ----------

router.get("/webapp/vendor", async (req, res) => {
  const vendorId = Number(req.query.vendorId);
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) {
    return res.status(400).json({ error: "vendorId is required" });
  }
  try {
    const { data: vendor, error } = await supabase
      .from("telegram_vendor")
      .select("id, name, address, open_time, close_time, deleted_at")
      .eq("id", vendorId)
      .maybeSingle();
    if (error) throw error;
    if (!vendor || vendor.deleted_at) return res.status(404).json({ error: "Vendor not found" });

    const [categories, rating] = await Promise.all([
      getCategoriesWithItems(vendorId),
      getVendorAverageRating(vendorId).catch(() => ({ average: 0, count: 0 })),
    ]);
    res.json({
      vendor: {
        id: vendor.id,
        name: vendor.name,
        address: vendor.address,
        open_time: vendor.open_time,
        close_time: vendor.close_time,
        open_now: isOpenNow(vendor.open_time, vendor.close_time),
        rating,
      },
      categories: categories
        .map((cat) => ({
          id: cat.id,
          name: cat.name,
          items: cat.item
            .map((i) => ({ id: i.id, name: i.name, price: i.price, stock: i.stock, image_url: i.image_url ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .filter((cat) => cat.items.length > 0),
    });
  } catch (err: any) {
    console.error(`[webapp] menu for vendor ${vendorId}: ${err.message}`);
    res.status(500).json({ error: "Could not load the menu" });
  }
});

// ---------- The customer's cart ----------
// The web menu and the chat share one cart: the customer's active telegram_cart row in Supabase.
// The page loads it when it opens, saves every change, and polls it, so a change made in the
// chat shows up in the menu and the other way round. Every call is checked against Telegram's
// signature with the vendor bot's token; the user id comes from that signature, never the body.
const MAX_LINES = 50;
const MAX_QTY = 99;

type Viewer = { vendorId: number; bot: import("node-telegram-bot-api"); userId: number };

function viewer(body: any): Viewer | { status: number; error: string } {
  const vendorId = Number(body?.vendorId);
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0 || typeof body?.initData !== "string") {
    return { status: 400, error: "vendorId and initData are required" };
  }
  const entry = getVendorBotEntry(vendorId);
  if (!entry) return { status: 503, error: "This vendor's bot is not running right now" };
  const user = verifyInitData(body.initData, entry.token);
  if (!user) return { status: 401, error: "Please reopen the menu from the bot" };
  return { vendorId, bot: entry.bot, userId: user.id };
}

// Prices and stock come from the database; the page only says which items and how many.
async function priceCart(vendorId: number, items: unknown): Promise<{ cart: CartItem[]; total: number } | { status: number; error: string }> {
  if (!Array.isArray(items) || items.length > MAX_LINES) return { status: 400, error: "Invalid cart" };
  const wanted = new Map<number, number>();
  for (const line of items) {
    const itemId = Number((line as any)?.itemId);
    const qty = Number((line as any)?.qty);
    if (!Number.isSafeInteger(itemId) || !Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { status: 400, error: "Invalid item or quantity" };
    }
    wanted.set(itemId, (wanted.get(itemId) ?? 0) + qty);
  }
  const menu = (await getCategoriesWithItems(vendorId)).flatMap((c) => c.item);
  const cart: CartItem[] = [];
  for (const [itemId, qty] of wanted) {
    const item = menu.find((i) => i.id === itemId);
    if (!item) return { status: 409, error: "An item in your cart is no longer on the menu" };
    if (qty > item.stock) {
      return { status: 409, error: item.stock > 0 ? `Only ${item.stock} ${item.name} left` : `${item.name} is out of stock` };
    }
    cart.push({ itemId: item.id, name: item.name, price: item.price, qty });
  }
  return { cart, total: cart.reduce((sum, i) => sum + i.price * i.qty, 0) };
}

const asLines = (items: CartItem[]) => items.map((i) => ({ itemId: i.itemId, qty: i.qty }));

// The customer's current cart, as the chat sees it.
router.post("/webapp/cart/state", async (req, res) => {
  const who = viewer(req.body);
  if ("error" in who) return res.status(who.status).json({ error: who.error });
  try {
    const current = await getCart(who.userId, who.vendorId);
    res.json({ items: asLines(current?.items ?? []), total: current?.total ?? 0 });
  } catch (err: any) {
    console.error(`[webapp] cart state for vendor ${who.vendorId}, user ${who.userId}: ${err.message}`);
    res.status(500).json({ error: "Could not load your cart" });
  }
});

// Saves the whole cart after each change in the menu, and quietly updates the cart message
// already in the chat. An empty list empties the cart.
router.post("/webapp/cart/sync", async (req, res) => {
  const who = viewer(req.body);
  if ("error" in who) return res.status(who.status).json({ error: who.error });
  try {
    const priced = await priceCart(who.vendorId, req.body?.items);
    if ("error" in priced) return res.status(priced.status).json({ error: priced.error });
    await upsertCart(who.userId, who.vendorId, priced.cart, priced.total);
    await editCartSummary(who.bot, who.userId, who.userId, who.vendorId);
    res.json({ items: asLines(priced.cart), total: priced.total });
  } catch (err: any) {
    console.error(`[webapp] cart sync for vendor ${who.vendorId}, user ${who.userId}: ${err.message}`);
    res.status(500).json({ error: "Could not save your cart" });
  }
});

// The web menu's checkout: saves the cart and sends it to the chat, where the bot's usual
// checkout (location, rider search, payment) continues.
router.post("/webapp/cart", async (req, res) => {
  const who = viewer(req.body);
  if ("error" in who) return res.status(who.status).json({ error: who.error });
  if (!Array.isArray(req.body?.items) || req.body.items.length === 0) {
    return res.status(400).json({ error: "Your cart is empty" });
  }
  try {
    const priced = await priceCart(who.vendorId, req.body.items);
    if ("error" in priced) return res.status(priced.status).json({ error: priced.error });
    await upsertCart(who.userId, who.vendorId, priced.cart, priced.total);
    // A private chat's id is the user's id. A Mini App opened in that chat means the user has
    // started the bot, so it may message them.
    await sendCartSummary(who.bot, who.userId, who.userId, who.vendorId);
    res.json({ ok: true, total: priced.total });
  } catch (err: any) {
    console.error(`[webapp] cart for vendor ${who.vendorId}, user ${who.userId}: ${err.message}`);
    res.status(500).json({ error: "Could not save your cart, please try again" });
  }
});

// ---------- Config for Mini Apps ----------

// Hands public config to the Mini App — only non-secret values.
router.get("/webapp/config", (_req, res) => {
  res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY || null });
});

// ---------- User location ----------

// Returns the user's saved delivery location (lat/lng).
router.get("/webapp/user/location", async (req, res) => {
  const initData = typeof req.query.initData === "string" ? req.query.initData : "";
  const vendorId = Number(req.query.vendorId);
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) {
    return res.status(400).json({ error: "vendorId is required" });
  }
  const entry = getVendorBotEntry(vendorId);
  if (!entry) return res.status(503).json({ error: "Bot not running" });
  const user = verifyInitData(initData, entry.token);
  if (!user) return res.status(401).json({ error: "Please reopen the menu from the bot" });
  try {
    const row = await getUserByTelegramId(user.id);
    res.json({ lat: row?.default_lat ?? null, lng: row?.default_lng ?? null });
  } catch (err: any) {
    res.status(500).json({ error: "Could not load location" });
  }
});

// Saves or updates the user's delivery location from the web menu.
router.post("/webapp/user/location", async (req, res) => {
  const who = viewer(req.body);
  if ("error" in who) return res.status(who.status).json({ error: who.error });
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }
  try {
    await upsertUserLocation(who.userId, lat, lng);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Could not save location" });
  }
});

// ---------- Active order tracking ----------

// Returns the user's most recent active order for this vendor (placed but not delivered/cancelled).
router.get("/webapp/order/active", async (req, res) => {
  const initData = typeof req.query.initData === "string" ? req.query.initData : "";
  const vendorId = Number(req.query.vendorId);
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) {
    return res.status(400).json({ error: "vendorId is required" });
  }
  const entry = getVendorBotEntry(vendorId);
  if (!entry) return res.status(503).json({ error: "Bot not running" });
  const user = verifyInitData(initData, entry.token);
  if (!user) return res.status(401).json({ error: "Please reopen the menu from the bot" });
  try {
    const { data, error } = await supabase
      .from("telegram_orders")
      .select("id, status, asap_status, subtotal, delivery_fee, total, created_at, driver_name, driver_phone, pickup_code, dropoff_code, ride_type")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId)
      .in("status", ["pending", "paid", "dispatched", "in_transit"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json({ order: data ?? null });
  } catch (err: any) {
    console.error(`[webapp] active order for user ${user.id}: ${err.message}`);
    res.status(500).json({ error: "Could not load order" });
  }
});

// ---------- Marketplace ----------

router.get("/webapp/vendors", async (req, res) => {
  const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 50) : "";
  try {
    // Linked by each running bot's real Telegram username.
    const linkByVendor = new Map(listVendorBots().map((b) => [b.vendorId, `https://t.me/${b.username}`]));
    if (!linkByVendor.size) return res.json({ vendors: [] });

    let query = supabase
      .from("telegram_vendor")
      .select("id, name, address, open_time, close_time")
      .in("id", [...linkByVendor.keys()])
      .is("deleted_at", null)
      .order("name")
      .limit(100);
    if (term) query = query.ilike("name", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
    const { data: vendors, error } = await query;
    if (error) throw error;

    const withRatings = await Promise.all((vendors ?? []).map(async (v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      open_now: isOpenNow(v.open_time, v.close_time),
      open_time: v.open_time,
      close_time: v.close_time,
      rating: await getVendorAverageRating(v.id).catch(() => ({ average: 0, count: 0 })),
      // ?start=menu makes the vendor bot greet the customer with a button to its web menu.
      link: `${linkByVendor.get(v.id)}?start=menu`,
    })));
    res.json({ vendors: withRatings });
  } catch (err: any) {
    console.error(`[webapp] vendor list: ${err.message}`);
    res.status(500).json({ error: "Could not load vendors" });
  }
});

export default router;
