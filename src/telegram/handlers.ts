import { Buffer } from "buffer";
import { createHash } from "crypto";

function telegramIdToUuid(telegramId: number): string {
  const h = createHash("sha1").update(String(telegramId)).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "4" + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}
import {
  insertOrder,
  insertPayment,
  getOrderById,
  getNearbyRiders,
  upsertUserPhone,
  upsertUserLocation,
  getUserByTelegramId,
  upsertCart,
  getCart,
  getItemStock,
  getVendorForBot,
  insertRating,
  getVendorAverageRating,
  savePickupCode,
  updateCartMessageId,
} from "../db/queries";
import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import { sendLocationToZazuMain } from "./zazu_main_client";
import { ZAZU_MAIN_BOT, ASAP_WEBHOOK_SECRET } from "../env";
import { getServerUrl } from "../ngrok";
import { CartItem, CartState } from "../types";
import axios from "axios";

const INTERNAL_HEADERS = { "x-asap-secret": ASAP_WEBHOOK_SECRET };

function recalcTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export async function handleSetLocation(
  bot: TelegramBot,
  chatId: number,
  query: CallbackQuery,
) {
  const userId = query.from.id;

  const user = await getUserByTelegramId(userId);

  if (user?.default_lat && user?.default_lng) {
    await bot.sendMessage(
      chatId,
      `Your current location is:\n${user.default_lat}, ${user.default_lng}`,
    );
    return;
  }

  await bot.sendMessage(chatId, "share your location", {
    reply_markup: {
      keyboard: [[{ text: "Share Location", request_location: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  });
}

export async function savePhoneNumberFlow(
  userId: number,
  phone: string,
  name: string,
) {
  await upsertUserPhone(userId, phone, name);
}

export async function saveLocationFlow(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  lat: number,
  lng: number,
) {
  await upsertUserLocation(userId, lat, lng);

  await sendLocationToZazuMain({ telegramId: userId, lat, lng });

  await bot.sendMessage(chatId, "Location saved!", {
    reply_markup: { remove_keyboard: true },
  });
}

export async function handleShowMenu(
  bot: TelegramBot,
  chatId: number,
  vendorId: number,
) {
  const vendor = await getVendorForBot(vendorId);

  const keyboard = vendor.categories.map((cat) => [
    { text: cat.name, callback_data: `OPEN_CATEGORY:${cat.id}` },
  ]);

  const rmsg = await bot.sendMessage(chatId, "...", { reply_markup: { remove_keyboard: true } });
  await bot.deleteMessage(chatId, rmsg.message_id).catch(() => {});
  await bot.sendMessage(chatId, "Choose a category:", {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleOpenCategory(
  bot: TelegramBot,
  chatId: number,
  vendorId: number,
  categoryId: number,
) {
  const vendor = await getVendorForBot(vendorId);
  const category = vendor.categories.find((c) => c.id === categoryId);

  if (!category) {
    return bot.sendMessage(chatId, "category not found");
  }

  for (const item of category.item) {
    const itemKeyboard = {
      inline_keyboard: [
        [
          {
            text: `Add to Cart — ₦${item.price}`,
            callback_data: `ADD_TO_CART:${item.id}`,
          },
        ],
      ],
    };

    if (item.image_url) {
      await bot.sendDocument(
        chatId,
        item.image_url,
        {
          caption: `*${item.name}*\n₦${item.price}`,
          parse_mode: "Markdown",
          reply_markup: itemKeyboard,
        },
        {
          filename: `${item.name}.jpg`,
          contentType: "image/jpeg",
        },
      );
    } else {
      await bot.sendMessage(chatId, `*${item.name}*\n₦${item.price}`, {
        parse_mode: "Markdown",
        reply_markup: itemKeyboard,
      });
    }
  }
}

export async function handleSelectItem(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
  itemId: number,
) {
  const vendor = await getVendorForBot(vendorId);
  const item = vendor.categories.flatMap((c) => c.item).find((i) => i.id === itemId);
  if (!item) return;

  if (item.stock <= 5) {
    return bot.sendMessage(chatId, "Out of Stock");
  }

  const [cartData, stock] = await Promise.all([
    getCart(userId, vendorId),
    getItemStock(item.id),
  ]);
  const items: CartItem[] = cartData?.items ?? [];
  const existing = items.find((i) => i.itemId === item.id);

  if (existing) {
    if (existing.qty >= stock) {
      return bot.sendMessage(
        chatId,
        `Only ${stock} ${item.name}(s) available — you already have ${existing.qty} in your cart.`,
      );
    }
    existing.qty += 1;
    await upsertCart(userId, vendorId, items, recalcTotal(items));
    return sendCartSummary(bot, chatId, userId, vendorId);
  }

  await bot.sendMessage(chatId, `How many ${item.name}?`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "1", callback_data: `QTY:${vendorId}:${itemId}:1` },
          { text: "2", callback_data: `QTY:${vendorId}:${itemId}:2` },
          { text: "3", callback_data: `QTY:${vendorId}:${itemId}:3` },
          { text: "4", callback_data: `QTY:${vendorId}:${itemId}:4` },
        ],
        [
          { text: "5", callback_data: `QTY:${vendorId}:${itemId}:5` },
          { text: "10", callback_data: `QTY:${vendorId}:${itemId}:10` },
        ],
      ],
    },
  });
}

export async function sendCartSummary(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
) {
  const cartData = await getCart(userId, vendorId);

  if (!cartData || cartData.items.length === 0) {
    return bot.sendMessage(chatId, "Your cart is empty.", {
      reply_markup: { remove_keyboard: true },
    });
  }

  const rmsg = await bot.sendMessage(chatId, "...", { reply_markup: { remove_keyboard: true } });
  await bot.deleteMessage(chatId, rmsg.message_id).catch(() => {});

  const items = cartData.items;
  let keyboard: any[] = [];

  const rows = items.map((c) => ({
    left: `${c.name} x${c.qty}`,
    right: `₦${(c.price * c.qty).toLocaleString()}`,
    item: c,
  }));

  const maxLeft = Math.max(...rows.map((r) => r.left.length));
  const lines = rows
    .map((r) => `${r.left.padEnd(maxLeft)}  = ${r.right}`)
    .join("\n");

  let text = `🛒 Cart:\n\n\`\`\`\n${lines}\n\`\`\``;

  for (const { item: c } of rows) {
    keyboard.push([
      { text: c.name, callback_data: "NOOP" },
      { text: "➖", callback_data: `DECREASE:${c.itemId}` },
      { text: "➕", callback_data: `INCREASE:${c.itemId}` },
      { text: "❌ Remove", callback_data: `REMOVE:${c.itemId}` },
    ]);
  }

  text += `\n\nTotal: ₦${cartData.total.toLocaleString()}`;
  keyboard.push([{ text: "Checkout", callback_data: "CHECKOUT" }]);

  if (cartData.cart_message_id) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: cartData.cart_message_id,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard },
      });
      return;
    } catch {
      // message deleted or too old — fall through to send a new one
    }
  }

  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });

  await updateCartMessageId(userId, vendorId, sent.message_id);
}

export async function handleAddItemWithQty(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
  itemId: number,
  qty: number,
) {
  const vendor = await getVendorForBot(vendorId);
  const item = vendor.categories.flatMap((c) => c.item).find((i) => i.id === itemId);
  if (!item) return;

  const [cartData, stock] = await Promise.all([
    getCart(userId, vendorId),
    getItemStock(itemId),
  ]);
  const items: CartItem[] = cartData?.items ?? [];
  const existing = items.find((i) => i.itemId === itemId);
  const currentQty = existing?.qty ?? 0;

  if (currentQty + qty > stock) {
    const canAdd = stock - currentQty;
    if (canAdd <= 0) {
      return bot.sendMessage(chatId, `You already have the maximum available (${stock}) in your cart.`);
    }
    return bot.sendMessage(chatId, `Only ${stock} ${item.name}(s) available. You can add at most ${canAdd} more.`);
  }

  if (existing) {
    existing.qty += qty;
  } else {
    items.push({ itemId: item.id, name: item.name, price: item.price, qty });
  }
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  await upsertCart(userId, vendorId, items, total);
  return sendCartSummary(bot, chatId, userId, vendorId);
}

export async function handleRemoveItem(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
  itemId: number,
) {
  const cartData = await getCart(userId, vendorId);
  if (!cartData) return;

  const items = cartData.items.filter((i) => i.itemId !== itemId);
  await upsertCart(userId, vendorId, items, recalcTotal(items));
  await sendCartSummary(bot, chatId, userId, vendorId);
}

export async function handleIncreaseQty(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
  itemId: number,
) {
  const cartData = await getCart(userId, vendorId);
  if (!cartData) return;

  const item = cartData.items.find((i) => i.itemId === itemId);
  if (!item) return;

  const stock = await getItemStock(itemId);
  if (item.qty >= stock) {
    return bot.sendMessage(
      chatId,
      `Only ${stock} ${item.name}(s) available — you already have the maximum in your cart.`,
    );
  }

  item.qty += 1;
  await upsertCart(
    userId,
    vendorId,
    cartData.items,
    recalcTotal(cartData.items),
  );
  await sendCartSummary(bot, chatId, userId, vendorId);
}

export async function handleDecreaseQty(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
  itemId: number,
) {
  const cartData = await getCart(userId, vendorId);
  if (!cartData) return;

  const item = cartData.items.find((i) => i.itemId === itemId);
  if (!item) return;

  item.qty -= 1;
  const items =
    item.qty <= 0
      ? cartData.items.filter((i) => i.itemId !== itemId)
      : cartData.items;

  await upsertCart(userId, vendorId, items, recalcTotal(items));
  await sendCartSummary(bot, chatId, userId, vendorId);
}

export async function handlePlaceOrder(
  bot: TelegramBot,
  chatId: number,
  _query: CallbackQuery,
) {
  await bot.sendMessage(chatId, "please enter your delivery address:");
}

export async function constructOrder({
  userId,
  vendorId,
  cart,
  deliveryPrice,
}: {
  userId: number;
  vendorId: number;
  cart: CartState;
  deliveryPrice: number;
}) {
  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = subtotal + deliveryPrice;

  const order = await insertOrder({
    user_id: userId,
    vendor_id: vendorId,
    subtotal,
    delivery_fee: deliveryPrice,
    total,
    status: "pending",
  });

  await insertPayment({
    order_id: order.id,
    paystack_ref: "",
    amount: total,
    status: "pending",
  });

  return order;
}

export async function handleCheckout(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
) {
  const cartData = await getCart(userId, vendorId);
  if (!cartData || cartData.items.length === 0) {
    await bot.sendMessage(chatId, "Your cart is empty 🛒");
    return;
  }

  const user = await getUserByTelegramId(userId);

  if (!user?.default_lat || !user?.default_lng) {
    await bot.sendMessage(
      chatId,
      "Please share your location first so we can find a rider near you.",
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

  const vendor = await getVendorForBot(vendorId);

  const searchMsg = await bot.sendMessage(
    chatId,
    "🔍 Searching for riders near your location...",
  );

  const preflightRes = await axios.post(
    `${getServerUrl()}/ride-preflight`,
    {
      rider_id: telegramIdToUuid(userId),
      pick_up: { lat: vendor.lat, lng: vendor.lng },
      drop_off: { lat: user.default_lat, lng: user.default_lng },
      ride_type: ["ASAP", "ASAPEXPRESS"].includes(vendor.acct_type) ? vendor.acct_type : "ASAPEXPRESS",
    },
    { headers: INTERNAL_HEADERS },
  ).catch(() => null);

  await bot.deleteMessage(chatId, searchMsg.message_id).catch(() => {});

  if (!preflightRes?.data?.can_serve) {
    await bot.sendMessage(
      chatId,
      "😔 No riders available near you right now.\nPlease try again in a few minutes.",
    );
    return;
  }

  const email = `${userId}@zazu.app`;

  const order = await constructOrder({
    userId,
    vendorId,
    cart: cartData,
    deliveryPrice: 0,
  });

  const webAppUrl =
    `${getServerUrl()}/pay.html` +
    `?ngrok-skip-browser-warning=true` +
    `&order_id=${order.id}` +
    `&amount=${order.total}` +
    `&email=${encodeURIComponent(email)}` +
    `&chat_id=${chatId}` +
    `&user_id=${userId}` +
    `&vendor_id=${vendorId}`;

  console.log(webAppUrl);

  await bot.sendMessage(
    chatId,
    `Order ready! Total: ₦${order.total}\nTap to pay:`,
    {
      reply_markup: {
        keyboard: [
          [{ text: "💳 Pay with Paystack", web_app: { url: webAppUrl } }],
        ],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    },
  );
}

export async function handlePayStart(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  email: string,
  vendorId: number,
  orderId: string,
  method: "sol" | "paystack",
) {
  const payload = {
    orderId,
    userId,
    email,
    vendorId,
    method,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");

  const deepLink = `https://t.me/${ZAZU_MAIN_BOT}?start=pay_${encoded}`;

  await bot.sendMessage(chatId, `Redirecting to payment...\n${deepLink}`);
}

export async function callASAP(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  riderId: string,
  dropoffPoint: any,
  pickupPoint: any,
  rideType: string,
  paymentMethod: string,
  userPhoneNumber: string | undefined,
  vendorPhoneNumber: string,
  orderId: string,
  vendorId: number,
) {
  const cartData = await getCart(userId, vendorId);
  const orderData = await getOrderById(Number(orderId));

  try {
    const itemDetails = (cartData?.items ?? []).map((item: CartItem) => ({
      name: item.name,
      price: item.price,
      dimensions: [4.0, 4.0, 4.0],
      quantity: item.qty,
      weight: 3.0,
    }));

    const ride_request_payload = {
      rider_id: riderId,
      pick_up: pickupPoint,
      drop_off: dropoffPoint,
      ride_type: rideType,
      payment_method: paymentMethod,
      items: itemDetails,
      order_id: orderData[0]?.order_ref ?? null,
      user_id: userId,
      user_phone_number: userPhoneNumber,
      vendor_phone_number: vendorPhoneNumber,
    };
    

    const response = await axios.post(
      `${getServerUrl()}/ride-request`,
      ride_request_payload,
      { headers: INTERNAL_HEADERS },
    );

    const rideData = response.data;

    if (!rideData.success) {
      await bot.sendMessage(chatId, "Could not create ride request 😔");
      return null;
    }

    const orderPayload = await orderComingThrough(rideData, orderData, rideType);

    return orderPayload;
  } catch (err: any) {
    const body = err.response?.data;
    console.error("Error sending ride request to Zazu-Main:", err.message, JSON.stringify(body, null, 2));
    await bot.sendMessage(chatId, "Error contacting delivery system 😔");
    return null;
  }
}

async function orderComingThrough(rideDetails: any, orderDetails: any, rideType: string) {
  const pickupCode = String(Math.floor(100000 + Math.random() * 900000));
  const orderId = orderDetails[0]?.id;
  if (orderId) {
    await savePickupCode(orderId, pickupCode, rideType).catch((err) =>
      console.error("Failed to save pickup code:", err.message),
    );
  }
  return {
    eta: rideDetails.estimated_arrival,
    timeInMin: rideDetails.estimated_time_min,
    status: rideDetails.validation_status,
    driverInfo: rideDetails.driver_assigned,
    pickupCode,
    orderDetails,
  };
}

function buildStarDisplay(average: number): string {
  const rounded = Math.round(average);
  return "⭐".repeat(rounded) + "☆".repeat(5 - rounded) + ` (${average.toFixed(1)})`;
}

export async function sendRatingPrompt(
  bot: TelegramBot,
  chatId: number,
  vendorId: number,
  orderId: number,
) {
  await bot.sendMessage(chatId, "How was your order? Rate your experience:", {
    reply_markup: {
      inline_keyboard: [[
        { text: "⭐ 1", callback_data: `rate_${vendorId}_${orderId}_1` },
        { text: "⭐ 2", callback_data: `rate_${vendorId}_${orderId}_2` },
        { text: "⭐ 3", callback_data: `rate_${vendorId}_${orderId}_3` },
        { text: "⭐ 4", callback_data: `rate_${vendorId}_${orderId}_4` },
        { text: "⭐ 5", callback_data: `rate_${vendorId}_${orderId}_5` },
      ]],
    },
  });
}

export async function handleRating(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
  orderId: number,
  rating: number,
  messageId: number,
) {
  await insertRating(userId, vendorId, orderId, rating);
  const { average, count } = await getVendorAverageRating(vendorId);
  const stars = "⭐".repeat(rating) + "☆".repeat(5 - rating);
  await bot.editMessageText(`${stars}\nThanks for rating!`, {
    chat_id: chatId,
    message_id: messageId,
  });
  await bot.setMyDescription({ description: `${buildStarDisplay(average)} · ${count} review${count !== 1 ? "s" : ""}` }).catch(() => {});
}
