import { Router } from "express";
import axios from "axios";
import crypto from "crypto";
import { PAYSTACK_SECRET_KEY } from "../env";
import { getOrderByPaystackRef } from "../db/queries";

const router = Router();

// Initialise a Paystack transaction and return the access_code to the Web App
router.post("/pay", async (req, res) => {
  const { email, amount, order_id, chat_id, user_id, vendor_id } = req.body;

  if (!email || !amount || !order_id || !chat_id || !user_id || !vendor_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const amountKobo = Math.round(Number(amount) * 100);
    const reference = `order_${order_id}_${Date.now()}`;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { email, amount: amountKobo, reference },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
    );

    res.json({
      access_code: response.data.data.access_code,
      reference: response.data.data.reference,
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
  const { bot } = await import("../telegram/zazu_vendor_acct");
  await bot.sendMessage(
    chatId,
    `✅ Payment confirmed! Your order is being prepared.`,
  );
});

export default router;
