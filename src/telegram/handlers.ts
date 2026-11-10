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
  OrderCheckout,
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
  saveDispatchRequest,
  getVendorPayout,
  updateCartMessageId,
  ensureFakeDriversNear,
  updateOrderBooking,
} from "../db/queries";
import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import { sendLocationToZazuMain, zazuId } from "./zazu_main_client";
import { PUBLIC_URL, DEV_MODE } from "../env";
import { CartItem } from "../types";
import { AsapError, SearchStarted, requestRide } from "../api/asap";
import { DeliveryItem, MAX_DELIVERY_UNITS, deliveryItems, orderCheckout, runPreflight } from "../api/checkout";

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

// The cart message's text and buttons, shared by the chat and the web menu.
function cartView(items: CartItem[], total: number) {
  const rows = items.map((c) => ({
    left: `${c.name} x${c.qty}`,
    right: `₦${(c.price * c.qty).toLocaleString()}`,
    item: c,
  }));
  const maxLeft = Math.max(...rows.map((r) => r.left.length));
  const lines = rows.map((r) => `${r.left.padEnd(maxLeft)}  = ${r.right}`).join("\n");
  const text = `🛒 Cart:\n\n\`\`\`\n${lines}\n\`\`\`\n\nTotal: ₦${total.toLocaleString()}`;
  const keyboard: any[] = rows.map(({ item: c }) => [
    { text: c.name, callback_data: "NOOP" },
    { text: "➖", callback_data: `DECREASE:${c.itemId}` },
    { text: "➕", callback_data: `INCREASE:${c.itemId}` },
    { text: "❌ Remove", callback_data: `REMOVE:${c.itemId}` },
  ]);
  keyboard.push([{ text: "Checkout", callback_data: "CHECKOUT" }]);
  return { text, keyboard };
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

  const { text, keyboard } = cartView(cartData.items, cartData.total);

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

// Keeps the cart message already in the chat in step with the web menu, quietly: it edits that
// message and never sends a new one, so changing quantities in the menu doesn't ping the chat.
export async function editCartSummary(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  vendorId: number,
) {
  const cartData = await getCart(userId, vendorId);
  if (!cartData?.cart_message_id) return;
  const options = { chat_id: chatId, message_id: cartData.cart_message_id };
  if (cartData.items.length === 0) {
    await bot.editMessageText("Your cart is empty.", { ...options, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    return;
  }
  const { text, keyboard } = cartView(cartData.items, cartData.total);
  // Telegram refuses an edit that changes nothing; that's fine here.
  await bot.editMessageText(text, { ...options, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
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
  checkout,
}: {
  userId: number;
  vendorId: number;
  checkout: OrderCheckout;
}) {
  const order = await insertOrder({
    ...checkout,
    user_id: userId,
    vendor_id: vendorId,
    status: "pending",
  });

  await insertPayment({
    order_id: order.id,
    paystack_ref: "",
    amount: checkout.total,
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

  // One rider carries at most 10 units (5 kg); say so before the customer pays.
  const units = cartData.items.reduce((sum, i) => sum + i.qty, 0);
  if (units > MAX_DELIVERY_UNITS) {
    await bot.sendMessage(
      chatId,
      `One delivery can carry up to ${MAX_DELIVERY_UNITS} items. Your cart has ${units}. Please remove ${units - MAX_DELIVERY_UNITS} and check out again.`,
    );
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

  // The backend picks the ride type (by trip length and which riders are free) and prices the
  // delivery; the order keeps both, with the token, for the ride request after payment.
  const pickup = { lat: vendor.lat, lng: vendor.lng };
  const dropoff = { lat: user.default_lat, lng: user.default_lng };

  // Test mode: put fake drivers beside the pickup (the vendor) before the rider check, so every
  // order can be tested end to end. With DEV_MODE the backend takes one free driver of either
  // vehicle and picks the ride type that driver can serve.
  if (DEV_MODE) {
    await ensureFakeDriversNear(vendor.lat, vendor.lng, "EV")
      .then(() => bot.sendMessage(chatId, "🛠️ Test mode: placed fake riders near the store."))
      .catch((err) => console.error("[dev] Could not place fake drivers:", err.message));
  }

  const quote = await runPreflight(pickup, dropoff, deliveryItems(cartData.items)).catch((err) => {
    console.error("[checkout] preflight failed:", err.message);
    return null;
  });

  await bot.deleteMessage(chatId, searchMsg.message_id).catch(() => {});

  if (!quote?.canServe) {
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
    checkout: orderCheckout(cartData.items, pickup, dropoff, quote),
  });

  const webAppUrl =
    `${PUBLIC_URL}/pay.html` +
    `?order_id=${order.id}` +
    `&amount=${order.total}` +
    `&email=${encodeURIComponent(email)}` +
    `&chat_id=${chatId}` +
    `&user_id=${userId}` +
    `&vendor_id=${vendorId}`;

  console.log(webAppUrl);

  await bot.sendMessage(
    chatId,
    `Order ready!\nItems: ₦${order.subtotal}\nDelivery: ₦${order.delivery_fee}\nTotal: ₦${order.total}\nTap to pay:`,
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

  const me = await bot.getMe();
  const deepLink = `https://t.me/${me.username}?start=pay_${encoded}`;

  await bot.sendMessage(chatId, `Redirecting to payment...\n${deepLink}`);
}

// After a 409, how long to wait between fresh preflights while no rider is free.
const PREFLIGHT_RETRY_MS = 60_000;

type Snapshot = {
  id: number;
  pickup_point: { lat: number; lng: number };
  dropoff_point: { lat: number; lng: number };
  dispatch_items: DeliveryItem[];
};
type Book = (rideType: string, preflightToken: string) => Promise<SearchStarted>;

// A fresh preflight for the order's own route and items, then the booking with its token. The
// fee is already paid, so only the ride type and token change. null: no rider is free right now
// (or the backend didn't answer the preflight).
async function bookWithFreshPreflight(order: Snapshot, book: Book): Promise<SearchStarted | null> {
  const quote = await runPreflight(order.pickup_point, order.dropoff_point, order.dispatch_items).catch((err) => {
    console.error(`[ride-request] order=${order.id}: preflight failed: ${err.message}`);
    return null;
  });
  if (!quote?.canServe) return null;
  await updateOrderBooking(order.id, quote.rideType, quote.token!);
  return book(quote.rideType, quote.token!);
}

// Runs a fresh preflight every PREFLIGHT_RETRY_MS until a rider is free, then books. Stops if the
// order stops being paid (cancelled meanwhile). Kept in memory: a restart ends the wait.
async function bookWhenRidersFree(order: Snapshot, book: Book): Promise<SearchStarted | null> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, PREFLIGHT_RETRY_MS));
    const current = (await getOrderById(order.id))[0];
    if (current?.status !== "paid") {
      console.log(`[ride-request] order=${order.id}: now ${current?.status ?? "gone"}; stopped waiting for a rider`);
      return null;
    }
    const started = await bookWithFreshPreflight(order, book);
    if (started) return started;
    console.log(`[ride-request] order=${order.id}: still no rider free; next preflight in ${PREFLIGHT_RETRY_MS / 1000}s`);
  }
}

// Books the paid order's delivery. Everything the backend checks against the preflight token
// (rider, pick-up, drop-off, ride type, items) comes from the order as checkout stored it, never
// from the live cart or location, so it matches what was quoted and paid for.
export async function callASAP(
  bot: TelegramBot,
  chatId: number,
  orderId: string,
  userPhoneNumber: string | undefined,
) {
  const orderData = await getOrderById(Number(orderId));

  try {
    const order = orderData[0];
    if (!order?.order_ref) {
      console.error(`[ride-request] order=${orderId} has no order_ref`);
      await bot.sendMessage(chatId, "Could not create ride request 😔");
      return null;
    }
    if (!order.preflight_token || !order.pickup_point || !order.dropoff_point || !order.dispatch_items) {
      console.error(`[ride-request] order=${orderId} has no preflight snapshot`);
      await bot.sendMessage(chatId, "Payment received but we could not book the delivery. Please contact support.");
      return null;
    }
    // The backend requires the customer's phone for Zazu orders.
    if (!userPhoneNumber) {
      await bot.sendMessage(chatId, "Please share your phone number with /start so the driver can reach you, then try again.");
      return null;
    }
    const vendor = await getVendorPayout(order.vendor_id);

    const book: Book = (rideType, preflightToken) =>
      requestRide({
        order_ref: order.order_ref,
        rider_id: zazuId,
        preflight_token: preflightToken,
        customer_phone: userPhoneNumber,
        pick_up: order.pickup_point,
        drop_off: order.dropoff_point,
        ride_type: rideType,
        payment_method: "cash",
        items: order.dispatch_items,
        pickup_name: vendor.name,
        pickup_contact_name: vendor.name,
        pickup_contact_phone: vendor.phone,
        user_id: order.user_id,
        user_phone_number: userPhoneNumber,
        vendor_phone_number: vendor.phone,
      });

    const booked = async (started: SearchStarted) => {
      console.log(`[ride-request] order=${order.id}: driver search started`, JSON.stringify(started));
      await saveDispatchRequest(order.id, userPhoneNumber, started.estimated_arrival ?? null).catch((err) =>
        console.error("Failed to save ride request details:", err.message),
      );
    };

    let started: SearchStarted | null;
    try {
      started = await book(order.ride_type, order.preflight_token);
    } catch (err) {
      // 409: the token expired (24 h) or the backend now answers differently for this request.
      if (!(err instanceof AsapError) || err.status !== 409) throw err;
      console.warn(`[ride-request] order=${order.id}: ${err.message}; running the preflight again`);
      started = await bookWithFreshPreflight(order, book);
    }

    if (!started) {
      await bot.sendMessage(chatId, "⏳ All riders near the store are busy. We'll book your delivery as soon as one is free.");
      void bookWhenRidersFree(order, book)
        .then((later) => later && booked(later))
        .catch(async (err) => {
          console.error(`[ride-request] order=${order.id}: booking after waiting failed: ${err.message}`);
          await bot.sendMessage(chatId, "We could not book your delivery. Please contact support.").catch(() => {});
        });
      return orderComingThrough({}, orderData);
    }

    await booked(started);
    return orderComingThrough(started, orderData);
  } catch (err: any) {
    console.error(`[ride-request] order=${orderId}: ${err.message}`);
    await bot.sendMessage(chatId, "Payment received but we could not book the delivery. Please contact support.");
    return null;
  }
}

// The ride-request answer only says the driver search has started (SearchStarted). The driver,
// the pickup code and the drop-off code come later from the backend in /ride-details; Zazu no
// longer makes its own pickup code.
function orderComingThrough(rideDetails: any, orderDetails: any) {
  return {
    eta: rideDetails.estimated_arrival as string | undefined,
    status: rideDetails.status as string | undefined,
    estimatedPrice: rideDetails.estimated_price as number | undefined,
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
