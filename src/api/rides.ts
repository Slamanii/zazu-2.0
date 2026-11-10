import { Router, Request, Response, NextFunction } from "express";
import TelegramBot from "node-telegram-bot-api";
import { ASAP_WEBHOOK_SECRET, NO_DRIVER_MAX_RETRIES, zazuCut } from "../env";
import { getVendorBot } from "../telegram/registry";
import { sendRatingPrompt } from "../telegram/handlers";
import {
  DispatchOrder,
  applyOrderStatus,
  claimPayout,
  countNoDriverRetry,
  getOrderByRef,
  getTelegramIdByPhone,
  getTripStatus,
  getVendorPayout,
  releasePayout,
  saveEta,
  saveRideDetails,
  saveTripStatus,
} from "../db/queries";
import { transferTo } from "./payment/paystackTransfer";
import { AsapError, assignDriver, preflight, requestRide } from "./asap";

// Every call between Zazu and the ASAP backend carries the shared secret, both ways.
function verifyAsapSecret(req: Request, res: Response, next: NextFunction) {
  if (!ASAP_WEBHOOK_SECRET || req.headers["x-asap-secret"] !== ASAP_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const router = Router();

function botFor(order: DispatchOrder): TelegramBot | null {
  try {
    return getVendorBot(order.vendor_id);
  } catch (err: any) {
    console.error(`[dispatch] order=${order.id}: ${err.message}`);
    return null;
  }
}

async function tellCustomer(order: DispatchOrder, text: string) {
  await botFor(order)?.sendMessage(order.user_id, text).catch((err) =>
    console.error(`[dispatch] order=${order.id}: could not message customer: ${err.message}`),
  );
}

// The vendor is the sender: they hand the package and the pickup code to the driver. Alongside
// the dashboard (pickup_code on the order), the vendor is messaged at the Telegram chat that
// shared the store's phone number with a bot; a vendor who never shared it is not messaged.
async function tellVendor(order: DispatchOrder, text: string) {
  const vendor = await getVendorPayout(order.vendor_id).catch(() => null);
  const chatId = vendor?.phone ? await getTelegramIdByPhone(vendor.phone).catch(() => null) : null;
  if (!chatId) {
    console.warn(`[dispatch] order=${order.id}: no Telegram chat has shared vendor ${order.vendor_id}'s phone; not messaged`);
    return;
  }
  await botFor(order)?.sendMessage(chatId, text).catch((err) =>
    console.error(`[dispatch] order=${order.id}: could not message vendor: ${err.message}`),
  );
}

// ---------- Zazu -> ASAP ----------

router.post("/ride-preflight", verifyAsapSecret, async (req, res) => {
  try {
    res.json(await preflight(req.body));
  } catch (err: any) {
    console.error("Error calling ASAP preflight:", err.message);
    res.status(500).json({ can_serve: false, error: err.message });
  }
});

// Places the order with the backend, once. The answer only says the driver search started;
// the driver arrives later in /ride-details. Passed through as sent: the ride type must be the
// one the preflight picked, or the backend refuses the request.
router.post("/ride-request", verifyAsapSecret, async (req, res) => {
  const payload = req.body;
  console.log("Received Ride Request", JSON.stringify(payload, null, 2));

  try {
    const started = await requestRide(payload);
    console.log("Driver search started:", JSON.stringify(started));
    res.json({ success: true, ...started });
  } catch (err: any) {
    console.error("Error calling ASAP API:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- ASAP -> Zazu ----------
// Each one answers 2xx straight away and does the work after: the backend retries on a timeout
// or a 5xx. A 4xx is not retried, so only a payload that can never be handled gets one.

// Sent when an order becomes no_driver, in_transit, delivered or cancelled.
router.post("/order-status", verifyAsapSecret, async (req, res) => {
  const { order_ref, status, updated_at } = req.body ?? {};
  if (typeof order_ref !== "string" || typeof status !== "string" || typeof updated_at !== "string") {
    return res.status(400).json({ error: "order_ref, status and updated_at are required" });
  }
  res.json({ received: true });

  try {
    const order = await applyOrderStatus(order_ref, status, updated_at);
    if (!order) {
      console.log(`[order-status] order_ref=${order_ref} ${status} ignored: unknown order or an older push`);
      return;
    }
    console.log(`[order-status] order=${order.id} ${status}`);

    switch (status) {
      case "no_driver":
        return await retryDriverSearch(order);
      case "in_transit":
        return await tellCustomer(
          order,
          "🛵 Your order has been picked up and is on its way!" +
            (order.dropoff_code ? `\nGive the driver this drop-off code when it arrives: ${order.dropoff_code}` : ""),
        );
      case "delivered":
        await tellCustomer(order, "✅ Your order has been delivered. Enjoy!");
        void payOutWhenTripCompleted(order).catch((err) =>
          console.error(`[payout] order=${order.id}: ${err.message}`),
        );
        {
          const bot = botFor(order);
          if (bot) {
            await sendRatingPrompt(bot, order.user_id, order.vendor_id, order.id).catch((err) =>
              console.error(`[order-status] order=${order.id}: rating prompt error: ${err.message}`),
            );
          }
        }
        return;
      case "cancelled":
        return await tellCustomer(order, "❌ Your delivery was cancelled. Please contact support if you need help.");
      default:
        console.warn(`[order-status] order=${order.id}: unhandled status ${status}`);
    }
  } catch (err: any) {
    console.error(`[order-status] order_ref=${order_ref}: ${err.message}`);
  }
});

// No driver took the order in the search window: ask the backend to search again (wider radius).
// Never re-sends the ride request. The backend sets no limit; NO_DRIVER_MAX_RETRIES can.
async function retryDriverSearch(order: DispatchOrder) {
  const attempt = (order.no_driver_retries ?? 0) + 1;
  if (NO_DRIVER_MAX_RETRIES > 0 && attempt > NO_DRIVER_MAX_RETRIES) {
    console.error(`[order-status] order=${order.id}: no driver after ${NO_DRIVER_MAX_RETRIES} retries; giving up`);
    await tellCustomer(order, "😔 We couldn't find a driver for your order. Please contact support.");
    return;
  }
  await countNoDriverRetry(order.id, attempt);
  if (attempt === 1) {
    await tellCustomer(order, "⏳ Drivers nearby are busy. We're still searching for one for you...");
  }

  try {
    const started = await assignDriver(order.order_ref);
    await saveEta(order.id, started.estimated_arrival ?? null).catch(() => {});
    console.log(`[order-status] order=${order.id}: driver search restarted (retry ${attempt})`);
  } catch (err) {
    const status = err instanceof AsapError ? err.status : undefined;
    // 409: it already has a driver or is closed; the latest push says which. 403/404: never
    // retryable. Anything else (backend down) is logged; the next no_driver push retries again.
    console.error(`[order-status] order=${order.id}: retry refused (${status ?? "no answer"}): ${(err as Error).message}`);
  }
}

// The payout waits for the backend's trip to read Completed. It is closed in the same step that
// marks the order delivered, so it normally already is; if not, it is checked again every
// TRIP_CHECK_MS, TRIP_CHECK_TRIES times, and then left for support (trip_status shows where).
const TRIP_CHECK_MS = 60_000;
const TRIP_CHECK_TRIES = 10;

async function payOutWhenTripCompleted(order: DispatchOrder) {
  for (let attempt = 1; ; attempt++) {
    const tripStatus = await getTripStatus(order.order_ref).catch((err) => {
      console.error(`[payout] order=${order.id}: could not read the trip: ${err.message}`);
      return null;
    });
    await saveTripStatus(order.id, tripStatus).catch((err) =>
      console.error(`[payout] order=${order.id}: could not save trip_status: ${err.message}`),
    );
    if (tripStatus === "Completed") return payOut(order);
    if (tripStatus === "Cancelled" || attempt >= TRIP_CHECK_TRIES) {
      console.error(`[payout] order=${order.id}: trip is ${tripStatus ?? "missing"}; not paid out`);
      return;
    }
    console.warn(`[payout] order=${order.id}: trip is ${tripStatus ?? "missing"}; checking again in ${TRIP_CHECK_MS / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, TRIP_CHECK_MS));
  }
}

// Zazu pays the vendor and its own driver once the trip is completed. The vendor gets the items'
// subtotal; the driver gets the delivery fee less Zazu's cut for the ride type and vehicle
// (ZAZU_CUT_* in env). Each payout is claimed first, so a repeated delivered push never pays
// twice; a failed transfer releases its claim.
async function payOut(order: DispatchOrder) {
  const cut = zazuCut(order.ride_type, order.asset_trip);
  const driverAmount = Math.floor(order.delivery_fee * (1 - cut));
  const vendorAmount = order.subtotal;
  const vendor = await getVendorPayout(order.vendor_id);

  const payouts: Promise<void>[] = [];

  if (!vendor.acct_details?.bank_account_number || !vendor.acct_details?.bank_code) {
    console.error(`[payout] order=${order.id}: vendor ${order.vendor_id} has no bank details; vendor not paid`);
  } else {
    payouts.push(pay(order.id, "vendor", () =>
      transferTo(vendor.name, vendor.acct_details!.bank_account_number, vendor.acct_details!.bank_code,
        vendorAmount, `Order #${order.id} vendor payout`)));
  }

  if (!order.driver_account_number || !order.driver_bank_code) {
    console.error(`[payout] order=${order.id}: no driver bank details from /ride-details; driver not paid`);
  } else {
    payouts.push(pay(order.id, "driver", () =>
      transferTo(order.driver_name ?? "Driver", order.driver_account_number!, order.driver_bank_code!,
        driverAmount, `Order #${order.id} driver payout`)));
  }

  await Promise.all(payouts);
  console.log(
    `[payout] order=${order.id} ${order.ride_type}${order.asset_trip ? " (asset)" : ""} ` +
      `vendor=₦${vendorAmount} driver=₦${driverAmount} zazu_cut=${cut}`,
  );
}

async function pay(orderId: number, who: "vendor" | "driver", transfer: () => Promise<void>) {
  if (!(await claimPayout(orderId, who))) {
    console.log(`[payout] order=${orderId}: ${who} already paid`);
    return;
  }
  try {
    await transfer();
  } catch (err: any) {
    console.error(`[payout] order=${orderId}: ${who} transfer failed: ${err.response?.data?.message ?? err.message}`);
    await releasePayout(orderId, who).catch(() => {});
  }
}

// Sent once a driver has taken the order, and again if it is reassigned to another driver.
router.post("/ride-details", verifyAsapSecret, async (req, res) => {
  const { order_ref, pick_up, drop_off, driver, asset_trip } = req.body ?? {};
  if (typeof order_ref !== "string" || !driver) {
    return res.status(400).json({ error: "order_ref and driver are required" });
  }
  res.json({ received: true });

  try {
    const before = await getOrderByRef(order_ref);
    if (!before) {
      console.error(`[ride-details] order_ref=${order_ref}: no such order`);
      return;
    }
    if (before.status === "delivered" || before.status === "cancelled") {
      console.log(`[ride-details] order=${before.id}: already ${before.status}; ignored`);
      return;
    }

    const driverId = driver.driver_id != null ? String(driver.driver_id) : null;
    await saveRideDetails(order_ref, {
      driver_id: driverId,
      driver_name: driver.name ?? null,
      driver_phone: driver.phone ?? null,
      driver_account_number: driver.account_number ?? null,
      driver_bank_code: driver.bank_code ?? null,
      pickup_code: pick_up?.code ?? null,
      dropoff_code: drop_off?.code ?? null,
      // The driver is on an investor-funded vehicle: Zazu's cut is ZAZU_CUT_<RIDE_TYPE>_ASSET.
      asset_trip: asset_trip === true,
    });

    // The same driver sent twice (a backend retry) is not news.
    if (before.driver_id === driverId && before.dropoff_code === (drop_off?.code ?? null)) return;
    const reassigned = !!before.driver_id && before.driver_id !== driverId;
    const order = { ...before, dropoff_code: drop_off?.code ?? null };
    const vehicle = [driver.vehicle_type, driver.vehicle].filter(Boolean).join(" · ");

    await tellCustomer(
      order,
      (reassigned ? "🔄 Your order has a new driver.\n" : "🚀 A driver is on the way to pick up your order!\n") +
        `Driver: ${driver.name ?? "—"} — ${driver.phone ?? "—"}\n` +
        (vehicle ? `Vehicle: ${vehicle}\n` : "") +
        (drop_off?.code ? `Drop-off code: ${drop_off.code}\nGive this code to the driver only when you receive your order.` : ""),
    );
    if (pick_up?.code) {
      await tellVendor(
        order,
        `${reassigned ? "🔄 New driver" : "🛵 Driver assigned"} for order #${order.id}.\n` +
          `Driver: ${driver.name ?? "—"} — ${driver.phone ?? "—"}\n` +
          `Pickup code: ${pick_up.code}\nGive this code to the driver when you hand over the package.`,
      );
    }
  } catch (err: any) {
    console.error(`[ride-details] order_ref=${order_ref}: ${err.message}`);
  }
});

// Sent once per order when the driver comes within 150 metres of the drop-off.
router.post("/driver-arrived", verifyAsapSecret, async (req, res) => {
  const { order_ref, driver_lat, driver_lng } = req.body ?? {};
  if (typeof order_ref !== "string") {
    return res.status(400).json({ error: "order_ref is required" });
  }
  console.log(`[driver-arrived] order_ref=${order_ref} driver=(${driver_lat},${driver_lng})`);
  res.json({ received: true });

  try {
    const order = await getOrderByRef(order_ref);
    if (!order) {
      console.error(`[driver-arrived] no order found for order_ref=${order_ref}`);
      return;
    }
    await tellCustomer(
      order,
      "📍 Your driver is almost there!" +
        (order.dropoff_code ? `\nHave your drop-off code ready: ${order.dropoff_code}` : ""),
    );
  } catch (err: any) {
    console.error(`[driver-arrived] order_ref=${order_ref}: ${err.message}`);
  }
});

export default router;
