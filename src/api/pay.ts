import { Router } from "express";
import axios from "axios";
import crypto from "crypto";
import { PAYSTACK_SECRET_KEY } from "../env";
import { getOrderById, getOrderByPaystackRef, updateOrderCheckout } from "../db/queries";
import { resyncCheckout } from "./checkout";

const router = Router();

// Initialise a Paystack transaction and return the access_code to the Web App. The amount is the
// order's own total, never the page's. If the cart or delivery location changed since checkout,
// the preflight is run again first and the order re-priced, so what is paid for is what gets
// booked.
router.post("/pay", async (req, res) => {
  const { email, order_id, chat_id, user_id, vendor_id } = req.body;

  if (!email || !order_id || !chat_id || !user_id || !vendor_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    let order = (await getOrderById(Number(order_id)))[0];
    if (!order || Number(order.user_id) !== Number(user_id)) {
      return res.status(404).json({ error: "Order not found." });
    }
    if (order.status !== "pending") {
      return res.status(409).json({ error: "This order has already been paid or closed." });
    }

    const resync = await resyncCheckout(order);
    if (!resync.ok) return res.status(409).json({ error: resync.error });
    if (resync.checkout) order = await updateOrderCheckout(order.id, resync.checkout);

    const amountKobo = Math.round(Number(order.total) * 100);
    const reference = `order_${order_id}_${Date.now()}`;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { email, amount: amountKobo, reference },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
    );

    res.json({
      access_code: response.data.data.access_code,
      reference: response.data.data.reference,
      amount: order.total,
      repriced: !!resync.checkout,
    });
  } catch (err: any) {
    const detail = err.response?.data ?? err.message;
    console.error("Paystack init error:", JSON.stringify(detail, null, 2));
    res.status(500).json({ error: "Failed to initialize payment", detail });
  }
});

// Paystack webhook — fires when payment is confirmed
router.post("/paystack-webhook", async (req, res) => {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.status(401).send("Invalid signature");
  }

  res.sendStatus(200);

  const { event, data } = req.body;
  if (event !== "charge.success") return;

  const reference = data.reference;
  const order = await getOrderByPaystackRef(reference);
  if (!order) return;

  const chatId = order.telegram_orders.user_id;
  const { getVendorBot } = await import("../telegram/registry");
  const bot = getVendorBot(order.telegram_orders.vendor_id);
  await bot.sendMessage(
    chatId,
    `✅ Payment confirmed! Your order is being prepared.`,
  );
});

export default router;
