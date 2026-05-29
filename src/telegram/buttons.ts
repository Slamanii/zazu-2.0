import TelegramBot from "node-telegram-bot-api";
import {
  handlePlaceOrder,
  handleSetLocation,
  handleShowMenu,
  handleOpenCategory,
  handleSelectItem,
  handleDecreaseQty,
  handleIncreaseQty,
  handleRemoveItem,
  handleCheckout,
  handlePayStart,
  handleAddItemWithQty,
  handleRating,
} from "./handlers";

export async function onButtonClick(
  bot: TelegramBot,
  query: any,
  vendorId: number,
) {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const email = query.from.email;

  if (data === "SET_LOCATION") {
    return handleSetLocation(bot, chatId, query);
  }

  if (data === "PLACE_ORDER") {
    return handlePlaceOrder(bot, chatId, query);
  }

  if (data === "SHOW_MENU") {
    return handleShowMenu(bot, chatId, vendorId);
  }

  if (data.startsWith("OPEN_CATEGORY:")) {
    const categoryId = Number(data.split(":")[1]);
    return handleOpenCategory(bot, chatId, vendorId, categoryId);
  }

  if (data.startsWith("ADD_TO_CART:")) {
    const itemId = Number(data.split(":")[1]);
    return handleSelectItem(bot, chatId, userId, vendorId, itemId);
  }

  if (data.startsWith("QTY:")) {
    const [, vid, iid, q] = data.split(":");
    return handleAddItemWithQty(bot, chatId, userId, Number(vid), Number(iid), Number(q));
  }

  if (data.startsWith("CHECKOUT")) {
    return handleCheckout(bot, chatId, userId, vendorId);
  }

  if (data.startsWith("REMOVE:")) {
    const itemId = Number(data.split(":")[1]);
    return handleRemoveItem(bot, chatId, userId, vendorId, itemId);
  }

  if (data.startsWith("INCREASE:")) {
    const itemId = Number(data.split(":")[1]);
    return handleIncreaseQty(bot, chatId, userId, vendorId, itemId);
  }

  if (data.startsWith("DECREASE:")) {
    const itemId = Number(data.split(":")[1]);
    return handleDecreaseQty(bot, chatId, userId, vendorId, itemId);
  }

  if (data.startsWith("PAYSTACK:")) {
    const orderId = data.split(":")[1];
    return handlePayStart(bot, chatId, userId, email, vendorId, orderId, "paystack");
  }

  if (data.startsWith("SOLPAY:")) {
    const orderId = data.split(":")[1];
    return handlePayStart(bot, chatId, userId, email, vendorId, orderId, "sol");
  }

  if (data.startsWith("rate_")) {
    const [, vid, oid, stars] = data.split("_");
    return handleRating(bot, chatId, userId, Number(vid), Number(oid), Number(stars), query.message.message_id);
  }
}
