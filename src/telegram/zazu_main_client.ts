import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api"
import { mainUserStore } from "../freezer/mainUserStore"
import { buildPreflightPayload } from "../freezer/vendorState";

export const ZAZU_MAIN_BOT = "ZazuMainBot"

export async function sendLocationToZazuMain(payload: { telegramId: number; lat: number; lng: number }) {

  console.log("Sending to Zazu Main:", payload)

  let user = await mainUserStore.findByTelegramId(payload.telegramId)

  if (!user) {
    user = await mainUserStore.createUser(payload.telegramId)
  }

    await mainUserStore.updateLocation(user.id, {
        lat: payload.lat,
        lng: payload.lng
    }) 

}







/* export async function handlePayStart(bot: TelegramBot, chatId: number, query: CallbackQuery) {

    const userRef = "<USER_REF>"
    const deepLink = `https://t.me/${ZAZU_MAIN_BOT}?start=pay_${userRef}`

    await bot.sendMessage(
        chatId,
        `Redirecting, continue in Zazu Main:\n${deepLink}`
    )
}
*/
