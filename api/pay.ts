import { Router } from "express";
import axios from "axios";
import crypto from "crypto";
import { PAYSTACK_SECRET_KEY } from "../src/env";
import { pendingPayments } from "../src/freezer/pendingPayments";

const router = Router();

// Initialise a Paystack transaction and return the access_code to the Web App
router.post("/pay", async (req, res) => {
  const { email, amount, order_id, chat_id, user_id, vendor_id } = req.body;

  if (!email || !amount || !order_id || !chat_id || !user_id || !vendor_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Amount from the bot is already in Naira (whole units) — convert to kobo
    const amountKobo = Math.round(Number(amount) * 100);
    // Make reference unique so retries don't get rejected by Paystack
    const reference = `order_${order_id}_${Date.now()}`;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { email, amount: amountKobo, reference },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
    );

    pendingPayments.set(reference, {
      chatId: Number(chat_id),
      userId: Number(user_id),
      vendorId: Number(vendor_id),
    });

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
  const pending = pendingPayments.get(reference);
  if (!pending) return;

  pendingPayments.delete(reference);

  const { bot } = await import("../src/telegram/zazu_vendor_acct");
  await bot.sendMessage(pending.chatId, `✅ Payment confirmed! Your order is being prepared.`);
});

export default router;
