import { Router } from "express";
import axios from "axios";
import { ASAP_BASE_URL, ASAP_WEBHOOK_SECRET } from "../env";
import { bot } from "../telegram/zazu_vendor_acct";
import { sendRatingPrompt } from "../telegram/handlers";
import { getOrderContext, getOrderForEscrow, updateOrderStatus } from "../db/queries";
import { transferTo } from "./payment/paystackTransfer";
import { Request, Response, NextFunction } from "express";

function verifyAsapSecret(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-asap-secret"] !== ASAP_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const router = Router();

router.post("/ride-preflight", verifyAsapSecret, async (req, res) => {
  const payload = req.body;

  console.log("Received preflight:", payload);

  try {
    const preflightResponse = await axios.post(
      `${ASAP_BASE_URL}/drivers/ride-preflight`,
      payload,
    );

    res.json(preflightResponse.data);
  } catch (err: any) {
    const body = err.response?.data;
    console.error("Error calling ASAP preflight:", err.message, JSON.stringify(body, null, 2));
    res.status(500).json({ can_serve: false, error: err.message });
  }
});

router.post("/ride-request", verifyAsapSecret, async (req, res) => {
  const payload = {
    ...req.body,
    ride_type: "ASAPEXPRESS",
  };

  console.log("Received Ride Request", JSON.stringify(payload, null, 2));

  try {
    const rideResponse = await axios.post(
      `${ASAP_BASE_URL}/riders/ride-request`,
      payload,
    );

    console.log("Ride assignment:", JSON.stringify(rideResponse.data, null, 2));
    res.json({ success: true, ...rideResponse.data });
  } catch (err: any) {
    const body = err.response?.data;
    console.error("Error calling ASAP API:", err.message, JSON.stringify(body, null, 2));
    res.status(500).json({ success: false, error: err.message });
  }
});

// Called by ASAP when driver coordinates coincide with pickup location
router.post("/driver-arrived", verifyAsapSecret, async (req, res) => {
  const { order_id, driver_lat, driver_lng } = req.body;

  console.log(`[driver-arrived] order=${order_id} driver=(${driver_lat},${driver_lng})`);

  res.json({ received: true });

  const orderIdNum = Number(order_id);

  const context = await getOrderContext(orderIdNum);
  if (!context) {
    console.error(`[driver-arrived] no order found for order=${orderIdNum}`);
    return;
  }

  const { telegramId, vendorId } = context;

  bot.sendMessage(telegramId, "Your delivery has arrived!").catch(() => {});

  setTimeout(() => {
    sendRatingPrompt(bot, telegramId, vendorId, orderIdNum)
      .catch((err) => console.error("[driver-arrived] rating prompt error:", err.message));
  }, 5 * 60 * 1000);
});

// Called by ASAP when driver enters pickup code in app
router.post("/confirm-pickup", verifyAsapSecret, async (req, res) => {
  const { order_id, pickup_code, driver_account_number, driver_bank_code } = req.body;

  try {
    const { order, vendor } = await getOrderForEscrow(String(order_id));

    if (order.status === "delivered") {
      return res.status(400).json({ error: "Order already settled" });
    }

    if (order.pickup_code !== String(pickup_code)) {
      return res.status(400).json({ error: "Invalid pickup code" });
    }

    const zazuCut = order.ride_type === "ASAPEXPRESS" ? 0.20 : 0.35;
    const driverAmount = Math.floor(order.delivery_fee * (1 - zazuCut));
    const vendorAmount = order.subtotal;

    await Promise.all([
      transferTo(
        vendor.name,
        vendor.acct_details.bank_account_number,
        vendor.acct_details.bank_code,
        vendorAmount,
        `Order #${order_id} vendor payout`,
      ),
      transferTo(
        "Driver",
        driver_account_number,
        driver_bank_code,
        driverAmount,
        `Order #${order_id} driver payout`,
      ),
    ]);

    await updateOrderStatus(Number(order_id), "delivered");

    console.log(`[confirm-pickup] order=${order_id} vendor=₦${vendorAmount} driver=₦${driverAmount}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[confirm-pickup] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
