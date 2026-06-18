import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api";
import { onButtonClick } from "./buttons";
import {
  saveLocationFlow,
  savePhoneNumberFlow,
  sendCartSummary,
  callASAP,
  sendRatingPrompt,
  handleRating,
} from "./handlers";
import {
  getPaymentStatus,
  getVendorByBotUsername,
  getUserByTelegramId,
  updatePaystackRef,
  updatePaymentStatus,
  updateOrderStatus,
  upsertCart,
  getVendorForBot,
} from "../db/queries";
import { zazuId } from "./zazu_main_client";
import { VENDOR_BOT } from "../env";

export const bot = new TelegramBot(VENDOR_BOT, { polling: true });

bot.on("polling_error", (err) =>
  console.error("[VENDOR_BOT] polling error:", err.message),
);

bot.on("update", (update) => {
  console.log("[VENDOR_BOT] update:", JSON.stringify(update, null, 2));
});

bot.setMyCommands([
  { command: "start", description: "Get started" },
  { command: "menu", description: "Browse the menu" },
  { command: "cart", description: "View your cart" },
  { command: "location", description: "View or update your delivery location" },
]);

export const preflightResults = new Map<
  number,
  {
    canServe: boolean;
    estimatedPrice: number;
    eta: number;
    requestId: string;
  }
>();

// ── /menu ────────────────────────────────────────────────
bot.onText(/\/menu/, async (msg: Message) => {
  try {
    const me = await bot.getMe();
    const bot_info = { id: me.id, username: me.username };
    const vendor_info = await getVendorByBotUsername(bot_info.username!);

    const vendor = await getVendorForBot(vendor_info.vendor_id);

    if (!vendor.categories.length) {
      return bot.sendMessage(msg.chat.id, "No categories found.");
    }

    const keyboard = vendor.categories.map((cat) => [
      { text: cat.name, callback_data: `OPEN_CATEGORY:${cat.id}` },
    ]);

    const rmsg = await bot.sendMessage(msg.chat.id, "...", { reply_markup: { remove_keyboard: true } });
    await bot.deleteMessage(msg.chat.id, rmsg.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id, "Choose a category:", {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err: any) {
    console.error("Failed to load vendor state:", err.message);
    bot.sendMessage(msg.chat.id, "Menu failed to load, please try again.");
  }
});

// ── /location ────────────────────────────────────────────
bot.onText(/\/location/, async (msg: Message) => {
  if (!msg.from) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const user = await getUserByTelegramId(userId);

  if (user?.default_lat && user?.default_lng) {
    await bot.sendLocation(chatId, user.default_lat, user.default_lng);
    await bot.sendMessage(
      chatId,
      "This is your saved location. Share a new one to update it.",
      {
        reply_markup: {
          keyboard: [[{ text: "Update Location", request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
    );
  } else {
    await bot.sendMessage(
      chatId,
      "No location saved yet. Share your location below.",
      {
        reply_markup: {
          keyboard: [[{ text: "Share Location", request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
    );
  }
});

// ── /cart ────────────────────────────────────────────────
bot.onText(/\/cart/, async (msg: Message) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  if (!userId) return;

  const me = await bot.getMe();
  const vendor_info = await getVendorByBotUsername(me.username!);
  await sendCartSummary(bot, chatId, userId, vendor_info.vendor_id);
});

// ── Callback buttons ─────────────────────────────────────
bot.on("callback_query", async (query: CallbackQuery) => {
  const chatId = query.message?.chat.id;
  try {
    const me = await bot.getMe();
    const vendor_info = await getVendorByBotUsername(me.username!);
    await onButtonClick(bot, query, vendor_info.vendor_id);
  } catch (err: any) {
    console.error("[VENDOR_BOT] callback_query error:", err.message, err);
    if (chatId) {
      await bot.sendMessage(chatId, "Something went wrong, please try again.").catch(() => {});
    }
  } finally {
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
});

// ── Location shared ──────────────────────────────────────
bot.on("location", async (msg: Message) => {
  if (!msg.location || !msg.from || !msg.chat) return;

  const userId: number = msg.from.id;
  const lat: number = msg.location.latitude;
  const lng: number = msg.location.longitude;
  const chatId: number = msg.chat.id;

  try {
    await saveLocationFlow(bot, chatId, userId, lat, lng);
  } catch (err: any) {
    console.error("Location flow error:", err.message);
    await bot.sendMessage(chatId, "Could not save location, please try again.");
  }
});

// ── Text messages ────────────────────────────────────────
bot.on("message", async (msg) => {
  // ── Web App payment callback ──────────────────────────
  console.log(
    `[VENDOR_BOT] @${msg.from?.username ?? msg.from?.id}: ${msg.text ?? "(non-text)"}`,
  );
  if (msg.web_app_data) {
    let payload: any;
    try {
      payload = JSON.parse(msg.web_app_data.data);
    } catch {
      return;
    }

    if (payload.event === "payment_success" && msg.from) {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const { reference, order_id } = payload;
      const orderId = String(order_id);

      try {
        const me = await bot.getMe();
        const vendor_info = await getVendorByBotUsername(me.username!);
        const [vendor, userDb] = await Promise.all([
          getVendorForBot(vendor_info.vendor_id),
          getUserByTelegramId(userId),
        ]);

        await updatePaystackRef(Number(orderId), reference);
        await updatePaymentStatus(Number(orderId), reference, "success");
        await updateOrderStatus(Number(orderId), "paid");

        await bot.sendMessage(
          chatId,
          "✅ Payment confirmed! Waiting for a rider to accept order...",
          { reply_markup: { remove_keyboard: true } },
        );

        if (!userDb?.default_lat || !userDb?.default_lng) {
          await bot.sendMessage(
            chatId,
            "Location not found. Please share your location and try again.",
          );
          return;
        }

        const pickupPoint = { lat: vendor.lat, lng: vendor.lng };
        const dropoffPoint = {
          lat: userDb.default_lat,
          lng: userDb.default_lng,
        };

        const orderPayload = await callASAP(
          bot,
          chatId,
          userId,
          zazuId,
          dropoffPoint,
          pickupPoint,
          "ASAPEXPRESS",
          "cash",
          userDb.phone ?? undefined,
          vendor.phone,
          orderId,
          vendor_info.vendor_id,
        );

        await upsertCart(userId, vendor_info.vendor_id, [], 0, "checked_out");

        if (orderPayload?.driverInfo) {
          await bot.sendMessage(
            chatId,
            `Driver: ${orderPayload.driverInfo.name} — ${orderPayload.driverInfo.phone}\n` +
              `ETA: ${orderPayload.eta} (${orderPayload.timeInMin} mins)\n` +
              `Pickup Code: ${orderPayload.pickupCode}\n` +
              `Order Total: ₦${orderPayload.orderDetails.total}`,
          );
        } else if (orderPayload) {
          await bot.sendMessage(chatId, "Order placed! Finding a driver for you...");
        }
      } catch (err: any) {
        console.error("Web App payment handler error:", err.message);
        await bot.sendMessage(
          chatId,
          "Payment received but could not assign rider. Please contact support.",
        );
      }
    }
    return;
  }

});

// ── /start (no param) — onboarding ──────────────────────
bot.onText(/^\/start$/, async (msg: Message) => {
  if (!msg.from) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const user = await getUserByTelegramId(userId);

  if (!user?.phone) {
    await bot.sendMessage(
      chatId,
      "Welcome! Please share your phone number to get started.",
      {
        reply_markup: {
          keyboard: [[{ text: "Share Phone Number", request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
    );
    return;
  }

  if (!user?.default_lat || !user?.default_lng) {
    await bot.sendMessage(
      chatId,
      "Now share your location so we can deliver to you.",
      {
        reply_markup: {
          keyboard: [[{ text: "Share Location", request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      },
    );
    return;
  }

  await bot.sendLocation(chatId, user.default_lat, user.default_lng);
  await bot.sendMessage(
    chatId,
    "This is your saved location. Type /menu to order, or share a new location to update it.",
    {
      reply_markup: {
        keyboard: [[{ text: "Update Location", request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    },
  );
});

// ── Contact shared ───────────────────────────────────────
bot.on("contact", async (msg: Message) => {
  if (!msg.contact || !msg.from) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Only accept contact shared by the user themselves
  if (msg.contact.user_id !== userId) return;

  try {
    await savePhoneNumberFlow(
      userId,
      msg.contact.phone_number,
      msg.from.first_name ?? "",
    );
  } catch (err: any) {
    console.error("Phone number flow error:", err.message);
    await bot.sendMessage(
      chatId,
      "Could not save phone number, please try again.",
    );
  }

  await bot.sendMessage(
    chatId,
    "Got it! Now share your location so we can deliver to you.",
    {
      reply_markup: {
        keyboard: [[{ text: "Share Location", request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    },
  );
});

// ── /start with payment param ────────────────────────────
bot.onText(/\/start (.+)/, async (msg, match) => {
  if (!msg.text || !msg.from) return;

  const me = await bot.getMe();
  const bot_info = { id: me.id, username: me.username };
  const vendor_info = await getVendorByBotUsername(bot_info.username!);

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const param = match?.[1];
  if (!param?.startsWith("paid_")) return;

  const [vendor, userDb] = await Promise.all([
    getVendorForBot(vendor_info.vendor_id),
    getUserByTelegramId(userId),
  ]);

  if (!userDb?.default_lat || !userDb?.default_lng) return;

  const orderId = param.replace("paid_", "");
  const data = await getPaymentStatus(Number(orderId));

  if (data?.status === "success") {
    await bot.sendMessage(chatId, "Payment Confirmed");

    const pickupPoint = { lat: vendor.lat, lng: vendor.lng };
    const dropoffPoint = {
      lat: userDb.default_lat,
      lng: userDb.default_lng,
    };

    const orderPayload = await callASAP(
      bot,
      chatId,
      userId,
      zazuId,
      dropoffPoint,
      pickupPoint,
       "ASAPEXPRESS",
      "cash",
      userDb.phone ?? undefined,
      vendor.phone,
      orderId,
      vendor_info.vendor_id,
    );

    if (orderPayload?.driverInfo) {
      await bot.sendMessage(
        chatId,
        `Driver: ${orderPayload.driverInfo.name} — ${orderPayload.driverInfo.phone}\n` +
          `ETA: ${orderPayload.eta} (${orderPayload.timeInMin} mins)\n` +
          `Pickup Code: ${orderPayload.pickupCode}\n` +
          `Order Total: ₦${orderPayload.orderDetails.total}`,
      );
    } else if (orderPayload) {
      await bot.sendMessage(chatId, "Order placed! Finding a driver for you...");
    } else {
      await bot.sendMessage(chatId, "Could not get delivery info 😔");
    }
  } else {
    await bot.sendMessage(chatId, "Payment failed, retry?", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💳 Pay with Paystack",
              callback_data: `PAYSTACK:${orderId}`,
            },
          ],
        ],
      },
    });
  }
});
