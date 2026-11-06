import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api";
import { supabase } from "../db/supabase";
import { createPaystackLink } from "../api/payment/paystack";
import { updatePaystackRef, upsertUserLocation } from "../db/queries";
import { WEB_APP_ENABLED, webAppUrl } from "./webapp_url";



// export const zazuId = crypto.randomUUID();
export const zazuId = "ee62ea27-abe2-4869-a989-a453a14f8747";

export async function sendLocationToZazuMain(payload: {
  telegramId: number;
  lat: number;
  lng: number;
}) {
  await upsertUserLocation(payload.telegramId, payload.lat, payload.lng);
}

export function attachMainHandlers(bot: TelegramBot) {
  const help = "Welcome to Zazu Marketplace!\n\n/search - browse available vendors\n/search pizza - find a vendor by name\n/help - show these commands\n\nChoose a vendor to open its bot and place your order.";
  async function replyWithVendors(chatId: number, term: string) {
    try {
      const { data: bots, error: botError } = await supabase.from("telegram_bots")
        .select("vendor_id, bot_id, bot_link").eq("is_active", true);
      if (botError) throw botError;
      const eligible = (bots ?? []).filter(row => row.vendor_id != null &&
        String(row.bot_id) !== process.env.ZAZU_MAIN_BOT_ID);
      const ids = eligible.map(row => row.vendor_id);
      if (!ids.length) { await bot.sendMessage(chatId, "No vendors are available right now. Please try again later."); return; }
      let query = supabase.from("telegram_vendor").select("id, name").in("id", ids).order("name").limit(20);
      if (term) query = query.ilike("name", "%" + term.replace(/[\\%_]/g, "\\$&") + "%");
      const { data: vendors, error } = await query;
      if (error) throw error;
      const keyboard = (vendors ?? []).flatMap(vendor => {
        const row = eligible.find(entry => entry.vendor_id === vendor.id);
        const username = String(row?.bot_id ?? "").replace(/^@/, "");
        const url = row?.bot_link || (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) ? `https://t.me/${username}` : "");
        if (!/^https:\/\/t\.me\/[A-Za-z0-9_]+$/.test(url)) return [];
        return [[{ text: vendor.name, url }]];
      });
      await bot.sendMessage(chatId, keyboard.length ? "Choose a vendor:" : "No matching vendors are available. Try /search to browse all vendors.",
        keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {});
    } catch {
      console.error("[ZAZU_MAIN] Vendor search failed");
      await bot.sendMessage(chatId, "The marketplace is temporarily unavailable. Please try /search again shortly.").catch(() => {});
    }
  }
  bot.onText(/^\/(?:start|help)(?:@[A-Za-z0-9_]+)?\s*$/i, async msg => {
    await bot.sendMessage(msg.chat.id, help, WEB_APP_ENABLED
      ? { reply_markup: { inline_keyboard: [[{ text: "🛍 Open marketplace", web_app: { url: webAppUrl(null) } }]] } }
      : {}).catch(() => {});
  });
  bot.onText(/^\/(?:search|menu)(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?\s*$/i, async (msg, match) => {
    await replyWithVendors(msg.chat.id, match?.[1]?.trim() ?? "");
  });
  bot.on("message", async msg => {
    if (msg.text && !msg.text.startsWith("/")) {
      await bot.sendMessage(msg.chat.id, "Use /search to browse vendors, or /search followed by a vendor name.").catch(() => {});
    }
  });

bot.on("message", (msg) => {
  console.log("Received message:", msg);
  console.log(
    `[ZAZU_MAIN] @${msg.from?.username ?? msg.from?.id}: ${msg.text ?? "(non-text)"}`,
  );
});

bot.onText(/\/start (.+)/, async (msg, match) => {
  console.log("Received deep link:", match?.[1]);
  const param = match?.[1];

  if (!param?.startsWith("pay_")) return;

  const encoded = param.replace("pay_", "");

  const decoded = Buffer.from(encoded, "base64").toString();

  const payload = JSON.parse(decoded);

  const { orderId, userId, vendorId, method } = payload;

  if (method === "paystack") {
    const paystackRef = crypto.randomUUID();

    await updatePaystackRef(orderId, paystackRef);

    const payUrl = await createPaystackLink(orderId, paystackRef);

    return bot.sendMessage(msg.chat.id, `Pay here:\n${payUrl}`);
  }

  if (method === "sol") {
    return bot.sendMessage(
      msg.chat.id,
      "Approve payment with your Sol wallet 🪙",
    );
  }
});

/* class ZazuEngine {

  async setLocation(userId, lat, lng)

  async showMenu(vendorId)

  async addItem(userId, itemId, qty)

  async parseTextOrder(userId, text)

  async calculateTotal(userId)

  async preflightDelivery(orderId)

  async requestPayment(orderId)

  async confirmPayment(orderId)

  async assignDriver(orderId)

  async notifyVendor(orderId)

  async completeOrder(orderId)

} */

}
