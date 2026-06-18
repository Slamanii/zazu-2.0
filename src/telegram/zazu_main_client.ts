import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api";
import { createPaystackLink } from "../api/payment/paystack";
import { updatePaystackRef, upsertUserLocation } from "../db/queries";
import { ZAZU_MAIN_BOT, ZAZU_MAIN_BOT_DEV, DEV_MODE } from "../env";

export const bot = new TelegramBot(DEV_MODE ? ZAZU_MAIN_BOT_DEV : ZAZU_MAIN_BOT, {
  polling: true,
});
// export const zazuId = crypto.randomUUID();
export const zazuId = "ee62ea27-abe2-4869-a989-a453a14f8747";

export async function sendLocationToZazuMain(payload: {
  telegramId: number;
  lat: number;
  lng: number;
}) {
  await upsertUserLocation(payload.telegramId, payload.lat, payload.lng);
}

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
