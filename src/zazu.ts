import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api"
import { mainUserStore } from "./freezer/mainUserStore"
import { createPaystackLink } from '../src/api/payment/paystack' 
import express from "express"
import { supabase } from "../src/db/supabase.js"
import axios from 'axios'

export const ZAZU_MAIN_BOT = "ZazuMainBot"
export const bot = new TelegramBot(ZAZU_MAIN_BOT, { polling: true })
export const zazuId = crypto.randomUUID() 

const app = express()
app.use(express.json())

app.post("/ride-preflight", async (req, res) => {
    const payload = req.body

    console.log("Received preflight:", payload)

    try {
    const preflightResponse = await axios.post('http://127.0.0.1:8080/ride-request', payload);

    res.json({
      can_serve: true,
      rec: preflightResponse.data
    });

    } catch (err: any) {
    console.error('Error calling ASAP API:', err.message);
    res.status(500).json({ can_serve: false, error: err.message });
  }

})

app.post("ride-request", async (req, res) => {
    const payload = req.body

    console.log("Received Ride Request", payload)

     try {
    const rideResponse = await axios.post('http://127.0.0.1:8080/ride-request', payload);

    const rideId = rideResponse.data.request_id;

    const driverResponse = await axios.get(`http://127.0.0.1:8080/assign-driver?ride_id=${rideId}`);

    res.json({
      success: true,
      ride: rideResponse.data,
      driver: driverResponse.data
    });

  } catch (err: any) {
    console.error('Error calling ASAP API:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }

})

app.listen(4000, () => console.log("Zazu Main Client listening on port 4000"))

bot.onText(/\/start (.+)/, async (msg, match) => {

  const param = match?.[1]

  if (!param?.startsWith("pay_")) return

  const encoded = param.replace("pay_", "")

  const decoded = Buffer.from(encoded, "base64").toString()

  const payload = JSON.parse(decoded)

  const { orderId, userId, vendorId, method } = payload

  if (method === "paystack") {
    const paystackRef = crypto.randomUUID()

    await supabase
        .from('payments')
        .update({ paystack_ref: paystackRef })
        .eq('order_id', orderId)

    const payUrl = await createPaystackLink(orderId, paystackRef)

    return bot.sendMessage(msg.chat.id, `Pay here:\n${payUrl}`)
  }

  if (method === "sol") {
    return bot.sendMessage(msg.chat.id, "Approve payment with your Sol wallet 🪙")
  }
})

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
