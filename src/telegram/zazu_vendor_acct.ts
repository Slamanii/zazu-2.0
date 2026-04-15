import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api";
import { onButtonClick } from "./buttons";
import { saveLocationFlow, sendCartSummary, callASAP } from "./handlers";
import {
  loadVendorState,
  buildPreflightPayload,
  vendorState,
} from "../freezer/vendorState";
import { localUserStore } from "../freezer/localUserStore";
import { VendorState } from "../types";
import { addItemToUserCart, userCartState } from "../freezer/userCartStore";
import { getPaymentStatus, getVendorByBotUsername } from "../db/queries";
import { zazuId } from "./zazu_main_client";
import { VENDOR_BOT } from "../env";
import axios from "axios";

export const bot = new TelegramBot(VENDOR_BOT, { polling: true });

let VENDOR_ID: string;

bot
  .getMe()
  .then(async (me) => {
    const botInfo = await getVendorByBotUsername(me.username!);
    VENDOR_ID = botInfo.vendor_id;
    console.log(`Bot @${me.username} linked to vendor: ${VENDOR_ID}`);
  })
  .catch((err) => {
    console.error("Failed to resolve vendor from bot username:", err.message);
  });

function findItemByName(state: VendorState, name: string) {
  return state.categories
    .flatMap((c) => c.item)
    .find((i) => i.name.toLowerCase() === name.toLowerCase());
}

bot.onText(/\/menu/, async (msg: Message) => {
  const me = await bot.getMe();
  console.log(me.id); // bot's telegram ID
  console.log(me.username); // bot's username e.g. "ZazuVendorBot"
  console.log(msg);
  try {
    await loadVendorState(VENDOR_ID);

    if (!vendorState || vendorState.categories.length === 0) {
      return bot.sendMessage(msg.chat.id, "No categories found.");
    }

    const keyboard = vendorState.categories.map((cat) => [
      { text: cat.name, callback_data: `OPEN_CATEGORY:${cat.id}` },
    ]);

    await bot.sendMessage(msg.chat.id, "Choose a category:", {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err: any) {
    console.error("Failed to load vendor state:", err.message);
    bot.sendMessage(msg.chat.id, "Menu failed to load, please try again.");
  }
});

bot.on("callback_query", async (query: CallbackQuery) => {
  await onButtonClick(bot, query);
});

export const preflightResults = new Map<
  number,
  {
    canServe: boolean;
    estimatedPrice: number;
    eta: number;
    requestId: string;
  }
>();

bot.on("location", async (msg: Message) => {
  if (!msg.location || !msg.from || !msg.chat || !vendorState) return;

  const userId: number = msg.from.id;
  const lat: number = msg.location.latitude;
  const lng: number = msg.location.longitude;
  const chatId: number = msg.chat.id;

  try {
    await saveLocationFlow(bot, chatId, userId, lat, lng);

    const payload = await buildPreflightPayload(userId);
    const res = await axios.post(
      "http://localhost:4000/ride-preflight",
      payload,
    );
    const result = res.data;

    preflightResults.set(userId, {
      canServe: result.can_serve,
      estimatedPrice: result.estimated_price,
      eta: result.eta_min,
      requestId: result.request_id,
    });

    if (!result.can_serve) {
      await bot.sendMessage(chatId, "No drivers available");
    }
  } catch (err: any) {
    console.error("Location flow error:", err.message);
    await bot.sendMessage(chatId, "Something went wrong, please try again.");
  }
});

bot.on("message", async (msg) => {
  console.log(
    `[VENDOR_BOT] @${msg.from?.username ?? msg.from?.id}: ${msg.text ?? "(non-text)"}`,
  );

  if (!msg.text || !msg.from || !vendorState) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const state = userCartState.get(chatId);

  if (state?.pendingItem) {
    const qty = Number(msg.text);
    if (!qty || qty <= 0) {
      return bot.sendMessage(chatId, "Enter a valid quantity");
    }

    const item = state.pendingItem;

    addItemToUserCart(userId, item, qty);

    delete state.pendingItem;

    return sendCartSummary(bot, chatId, userId);
  }

  // for keyboard input like: "Apple (2)"

  const match = msg.text.trim().match(/^(.+)\((\d+)\)$/);

  if (!match) return;

  const itemName = match[1];
  const qty = Number(match[2]);

  const item = findItemByName(vendorState, itemName);

  if (!item) {
    return bot.sendMessage(chatId, "Item not found");
  }

  if (item.stock <= 0) {
    return bot.sendMessage(chatId, "Out of stock");
  }

  try {
    addItemToUserCart(userId, item, qty);
    return sendCartSummary(bot, chatId, userId);
  } catch {
    return bot.sendMessage(chatId, "Error adding item");
  }
});

bot.onText(/\/start (.+)/, async (msg, match) => {
  if (!msg.text || !msg.from || !vendorState) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const state = await localUserStore.getUser(userId);
  if (!state?.location) throw new Error("User location missing");

  const pickupPoint = { lat: vendorState.lat, lng: vendorState.lng };
  const dropoffPoint = { lat: state.location.lat, lng: state.location.lng };
  const userPhoneNumber = state.phone;
  const rideType = vendorState.acct_type || "default";
  const vendorPhoneNumber = vendorState.phone;
  const paymentMethod = "cash";

  const param = match?.[1];

  if (!param?.startsWith("paid_")) return;

  const orderId = param.replace("paid_", "");

  const data = await getPaymentStatus(orderId);

  if (data?.status === "success") {
    await bot.sendMessage(msg.chat.id, "Payment Confirmed");

    const orderPayload = await callASAP(
      bot,
      chatId,
      userId,
      zazuId,
      dropoffPoint,
      pickupPoint,
      rideType,
      paymentMethod,
      userPhoneNumber,
      vendorPhoneNumber,
      orderId,
    );

    if (orderPayload) {
      await bot.sendMessage(
        msg.chat.id,
        `Driver: ${(orderPayload.driverInfo.name, orderPayload.driverInfo.phone)}\n` +
          `ETA: ${orderPayload.eta} (${orderPayload.timeInMin} mins)\n` +
          `Pickup Code: ${orderPayload.pickupCode}\n` +
          `Order Total: ₦${orderPayload.orderDetails.total}`,
      );
    } else {
      await bot.sendMessage(msg.chat.id, "Could not get delivery info 😔");
    }
  } else {
    await bot.sendMessage(msg.chat.id, "payment failed, retry?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Pay: PAYSTACK", callback_data: `PAYSTACK:${orderId}` }],
          [{ text: "Pay: SOLPAY", callback_data: `SOLPAY:${orderId}` }],
        ],
      },
    });
  }
});
