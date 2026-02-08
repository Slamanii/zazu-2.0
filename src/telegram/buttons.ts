import TelegramBot from "node-telegram-bot-api";
import { handlePlaceOrder, handleSetLocation, handleShowMenu, handleOpenCategory, handleSelectItem, handleDecreaseQty, handleIncreaseQty, handleRemoveItem, handleCheckout, handlePayStart  } from "./handlers"


export async function onButtonClick(bot: TelegramBot, query: any) {

    const data = query.data
    const VENDOR_ID = query.vendor.id //this is probably wrong
    const chatId = query.message.chat.id
    const userId = query.from.id
    const email = query.from.email

    if (data === "SET_LOCATION") {
        return handleSetLocation(bot, chatId, query)
    }

    if (data === "PLACE_ORDER") {
        return handlePlaceOrder(bot, chatId, query)
    }

    if (data === "SHOW_MENU") {
        return handleShowMenu(bot, chatId)
    }

    if (data.startsWith("OPEN_CATEGORY:")) {
        const categoryId = data.split(":")[1]
        return handleOpenCategory(bot, chatId, categoryId)
    }

    if (data.startsWith("ADD_TO_CART:")) {
        const itemId = data.split(":")[1]
        return handleSelectItem(bot, chatId, userId, itemId)
    }

    if (data.startsWith("CHECKOUT")) {
        return handleCheckout(bot, chatId, userId, VENDOR_ID)
    }
    
    if (data.startsWith("REMOVE:")) {
        const itemId = data.split(":")[1]
        return handleRemoveItem(bot, chatId, userId, itemId)
    }

    if (data.startsWith("INCREASE:")) {
        const itemId = data.split(":")[1]
        return handleIncreaseQty(bot, chatId, userId, itemId)
    }

    if (data.startsWith("DECREASE:")) {
        const itemId = data.split(":")[1]
        return handleDecreaseQty(bot, chatId, userId, itemId)
    }

    if (data.startsWith("PAYSTACK:")) {
        const orderId = data.split(":")[1]

        return handlePayStart(
            bot,
            chatId,
            userId,
            email,
            VENDOR_ID,
            orderId,
            "paystack"
        )
    }

    if (data.startsWith("SOLPAY:")) {
        const orderId = data.split(":")[1]

        return handlePayStart(
            bot,
            chatId,
            userId,
            email,
            VENDOR_ID,
            orderId,
            "sol"
        )
    }
}

    {/*
        const action = query.callback_data;
    const chatId = query.message.chat.id;
    const categoryId = query.data.split(":")[1]
    const itemId = query.data.split(":")[1]

    switch (action) {

        case "SET_LOCATION":
            return handleSetLocation(bot, chatId, query)

        case "PLACE_ORDER":
            return handlePlaceOrder(bot, chatId, query)

        case "SHOW MENU":
            return handleShowMenu(bot, chatId)

        case "OPEN_CATEGORY:" + categoryId:
            return handleOpenCategory(bot, chatId, categoryId)
                
        case "ADD_TO_CART:" + itemId: 
            return handleSelectItem(bot, chatId, itemId, userId)


            case "LOCATION":
                return bot.sendMessage(chatId, "Please share your location:")

            case "MENU":
                return bot.sendMessage(chatId, "Here is the menu:")

            case "MY_ORDERS":
                return bot.sendMessage(chatId, "Here are your orders:")

            case "SETTINGS":
                return bot.sendMessage(chatId, "Here are your settings:")

            case "HELP":
                return bot.sendMessage(chatId, "How can I help you?")

            case "WALLETS":
                return bot.sendMessage(chatId, "Here are your wallets:")

        default:
            return bot.sendMessage(chatId, "Unknown action.")

    }
*/}
