import { Buffer } from "buffer";
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
} from "../db/queries";
import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import { localUserStore } from "../freezer/localUserStore";
import { sendLocationToZazuMain } from "./zazu_main_client";
import { ZAZU_MAIN_BOT } from "../env";
import { getServerUrl } from "../ngrok";
import { VendorState, CartItem, CartState } from "../types";
import { getUiState } from "../freezer/userCartStore";
import { getVendorState } from "../freezer/vendorState";
import axios from "axios";

function findItemById(state: VendorState, id: number) {
  return state.categories.flatMap((c) => c.item).find((i) => i.id === id);
}

function recalcTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export async function handleSetLocation(
  bot: TelegramBot,
  chatId: number,
  query: CallbackQuery,
) {
  const userId = query.from.id;

  const user = await localUserStore.getUser(userId);

  if (user?.location) {
    await bot.sendMessage(
      chatId,
      `Your current location is:\n${user.location.lat}, ${user.location.lng}`,
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
  await localUserStore.setPhone(userId, phone);
  await upsertUserPhone(userId, phone, name);
}

export async function saveLocationFlow(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  lat: number,
  lng: number,
) {
  await localUserStore.setLocation(userId, { lat, lng });
  await upsertUserLocation(userId, lat, lng);

  await sendLocationToZazuMain({ telegramId: userId, lat, lng });

  await bot.sendMessage(chatId, "Location saved!");
}

export async function handleShowMenu(
  bot: TelegramBot,
  chatId: number,
  vendorId: number,
) {
  const vendorState = getVendorState(vendorId);

  if (!vendorState) {
    return bot.sendMessage(chatId, "Menu loading...");
  }

  const keyboard = vendorState.categories.map((cat) => [
    { text: cat.name, callback_data: `OPEN_CATEGORY:${cat.id}` },
  ]);

  await bot.sendMessage(chatId, "Menu:", {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleOpenCategory(
  bot: TelegramBot,
  chatId: number,
  vendorId: number,
  categoryId: number,
) {
  const vendorState = getVendorState(vendorId);

  if (!vendorState) {
    return bot.sendMessage(chatId, "Menu loading");
  }

  const category = vendorState.categories.find((c) => c.id === categoryId);

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
  const vendorState = getVendorState(vendorId);
  if (!vendorState) return;

  const item = findItemById(vendorState, itemId);
  if (!item) return;

  if (item.stock <= 5) {
    return bot.sendMessage(chatId, "Out of Stock");
  }

  const cartData = await getCart(userId, vendorId);
  const items: CartItem[] = cartData?.items ?? [];
  const existing = items.find((i) => i.itemId === item.id);

  if (existing) {
    existing.qty += 1;
    await upsertCart(userId, vendorId, items, recalcTotal(items));
    return sendCartSummary(bot, chatId, userId, vendorId);
  }

  const ui = getUiState(chatId);
  ui.pendingItem = item;
  ui.vendorId = vendorId;

  await bot.sendMessage(chatId, `How many ${item.name}?`, {
    reply_markup: {
      keyboard: [
        [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }],
        [{ text: "5" }, { text: "10" }],
        [{ text: "Cancel" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
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
    return bot.sendMessage(chatId, "Your cart is empty.");
  }

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

  const ui = getUiState(chatId);

  if (ui.cartMessageId) {
    await bot.deleteMessage(chatId, ui.cartMessageId).catch(() => {});
    ui.cartMessageId = undefined;
  }

  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });

  ui.cartMessageId = sent.message_id;
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

  item.qty += 1;
  await upsertCart(userId, vendorId, cartData.items, recalcTotal(cartData.items));
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

  const nearbyRiders = await getNearbyRiders(
    user.default_lat,
    user.default_lng,
    10,
  );

  if (nearbyRiders.length === 0) {
    await bot.sendMessage(
      chatId,
      "No riders available within 10km of your location right now. Please try again soon.",
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

    const payload = {
      riderId,
      pickupPoint,
      dropoffPoint,
      rideType,
      paymentMethod,
      itemsDetails: itemDetails,
      orderId,
      userId,
      userPhoneNumber,
      vendorPhoneNumber,
    };

    const response = await axios.post(
      "http://localhost:4000/ride-request",
      payload,
    );

    const rideData = response.data;

    if (!rideData.success) {
      await bot.sendMessage(chatId, "Could not create ride request 😔");
      return null;
    }

    const orderPayload = await orderComingThrough(rideData, orderData);

    return orderPayload;
  } catch (err: any) {
    console.error("Error sending ride request to Zazu-Main:", err.message);
    await bot.sendMessage(chatId, "Error contacting delivery system 😔");
    return null;
  }
}

async function orderComingThrough(rideDetails: any, orderDetails: any) {
  const pickupCode = Math.floor(100000 + Math.random() * 900000);

  return {
    eta: rideDetails.estimated_arrival,
    timeInMin: rideDetails.estimated_time_min,
    status: rideDetails.validation_status,
    driverInfo: rideDetails.driver_assigned,
    pickupCode,
    orderDetails,
  };
}
