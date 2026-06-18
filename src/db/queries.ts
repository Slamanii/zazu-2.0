import { supabase } from "./supabase";
import { Category, CartItem } from "../types";

// ---------- Bot ----------

export async function getVendorByBotUsername(botUsername: string) {
  const { data, error } = await supabase
    .from("telegram_bots")
    .select("vendor_id, bot_id, bot_username, is_active")
    .eq("bot_username", botUsername)
    .single();
  if (error) throw error;
  if (!data.is_active) throw new Error(`Bot @${botUsername} is inactive`);
  return data;
}

// ---------- Vendor ----------

export async function getVendorById(vendorId: number) {
  const { data, error } = await supabase
    .from("telegram_vendor")
    .select("*")
    .eq("id", vendorId)
    .single();
  if (error) throw error;
  return data;
}

export async function getCategoriesWithItems(vendorId: number) {
  const { data, error } = await supabase
    .from("telegram_vendor_menu")
    .select(
      `
      id,
      category_name,
      telegram_vendor_item (
        id,
        name,
        price,
        stock,
        image_url
      )
    `,
    )
    .eq("vendor_id", vendorId);
  if (error) throw error;

  return data.map((cat) => ({
    id: cat.id,
    name: cat.category_name,
    item: cat.telegram_vendor_item ?? [],
  })) as Category[];
}

export async function getVendorForBot(vendorId: number): Promise<{
  id: number; lat: number; lng: number; phone: string; acct_type: string;
  categories: Category[];
}> {
  const [vendor, categories] = await Promise.all([
    getVendorById(vendorId),
    getCategoriesWithItems(vendorId),
  ]);
  return { ...vendor, categories };
}

export async function getOrderByPaystackRef(ref: string) {
  const { data } = await supabase
    .from("telegram_payments")
    .select("order_id, telegram_orders(user_id, vendor_id)")
    .eq("paystack_ref", ref)
    .single();
  return data as { order_id: number; telegram_orders: { user_id: number; vendor_id: number } } | null;
}

export async function getItemStock(itemId: number): Promise<number> {
  const { data } = await supabase
    .from("telegram_vendor_item")
    .select("stock")
    .eq("id", itemId)
    .single();
  return data?.stock ?? 0;
}

// ---------- Users ----------

export async function getUserByTelegramId(telegramId: number) {
  const { data, error } = await supabase
    .from("telegram_custom_users")
    .select("telegram_user_id, name, phone, default_lat, default_lng")
    .eq("telegram_user_id", telegramId)
    .single();
  if (error) return null;
  return data;
}

async function ensureUser(telegramId: number) {
  const existing = await getUserByTelegramId(telegramId);
  if (!existing) {
    const { error } = await supabase
      .from("telegram_custom_users")
      .insert({ telegram_user_id: telegramId });
    if (error) throw error;
  }
}

export async function upsertUserPhone(telegramId: number, phone: string, name: string) {
  await ensureUser(telegramId);
  const { error } = await supabase
    .from("telegram_custom_users")
    .update({ phone, name })
    .eq("telegram_user_id", telegramId);
  if (error) throw error;
}

export async function upsertUserLocation(telegramId: number, lat: number, lng: number) {
  await ensureUser(telegramId);
  const { error } = await supabase
    .from("telegram_custom_users")
    .update({ default_lat: lat, default_lng: lng })
    .eq("telegram_user_id", telegramId);
  if (error) throw error;
}

// ---------- Orders ----------

export async function insertOrder(order: {
  user_id: number;
  vendor_id: number;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
}) {
  const { data, error } = await supabase
    .from("telegram_orders")
    .insert(order)
    .select("*")
    .single();
  if (error || !data)
    throw new Error("Failed to create order: " + error?.message);
  return data;
}

export async function getOrderById(orderId: number) {
  const { data, error } = await supabase
    .from("telegram_orders")
    .select("*")
    .eq("id", orderId);
  if (error || !data) throw new Error("Order not found: " + error?.message);
  return data;
}

export async function updateOrderStatus(orderId: number, status: string) {
  const { error } = await supabase
    .from("telegram_orders")
    .update({ status })
    .eq("id", orderId);
  if (error) throw error;
}

// ---------- Payments ----------

export async function insertPayment(payment: {
  order_id: number;
  paystack_ref: string;
  amount: number;
  status: string;
}) {
  const { data, error } = await supabase
    .from("telegram_payments")
    .insert(payment)
    .select("*")
    .single();
  if (error || !data)
    throw new Error("Failed to create payment: " + error?.message);
  return data;
}

export async function updatePaystackRef(orderId: number, paystackRef: string) {
  const { error } = await supabase
    .from("telegram_payments")
    .update({ paystack_ref: paystackRef })
    .eq("order_id", orderId);
  if (error) throw error;
}

export async function updatePaymentStatus(
  orderId: number,
  paystackRef: string,
  status: string,
) {
  const { error } = await supabase
    .from("telegram_payments")
    .update({ status })
    .eq("order_id", orderId)
    .eq("paystack_ref", paystackRef);
  if (error) throw error;
}

// ---------- Riders ----------

// Returns riders whose distance to (userLat, userLng) is within radiusKm.
// Uses the Haversine formula in SQL to avoid fetching all riders.
export async function getNearbyRiders(
  userLat: number,
  userLng: number,
  radiusKm: number = 10,
) {
  const { data, error } = await supabase.rpc("telegram_get_nearby_riders", {
    user_lat: userLat,
    user_lng: userLng,
    radius_km: radiusKm,
  });
  if (error) throw error;
  return data as {
    id: string;
    latitude: number;
    longitude: number;
    distance_km: number;
  }[];
}

export async function getPaymentStatus(orderId: number) {
  const { data, error } = await supabase
    .from("telegram_payments")
    .select("status")
    .eq("order_id", orderId)
    .single();
  if (error) throw error;
  return data;
}

export async function getCart(userId: number, vendorId: number) {
  const { data } = await supabase
    .from("telegram_cart")
    .select("items, total, status, cart_message_id")
    .eq("user_id", userId)
    .eq("vendor_id", vendorId)
    .eq("status", "active")
    .single();
  return data as { items: CartItem[]; total: number; status: string; cart_message_id: number | null } | null;
}

export async function updateCartMessageId(userId: number, vendorId: number, messageId: number) {
  const { error } = await supabase
    .from("telegram_cart")
    .update({ cart_message_id: messageId })
    .eq("user_id", userId)
    .eq("vendor_id", vendorId)
    .eq("status", "active");
  if (error) console.error("updateCartMessageId error:", error.message);
}

export async function upsertCart(
  userId: number,
  vendorId: number,
  items: CartItem[],
  total: number,
  status: "active" | "checked_out" | "cancelled" = "active",
) {
  await ensureUser(userId);
  if (status === "active") {
    const { data, error } = await supabase
      .from("telegram_cart")
      .update({ items, total })
      .eq("user_id", userId)
      .eq("vendor_id", vendorId)
      .eq("status", "active")
      .select("id");
    if (error) { console.error("upsertCart update error:", error.message); return; }

    if (!data || data.length === 0) {
      const { error: insertError } = await supabase
        .from("telegram_cart")
        .insert({ user_id: userId, vendor_id: vendorId, items, total, status: "active" });
      if (insertError) console.error("upsertCart insert error:", insertError.message);
    }
  } else {
    const { error } = await supabase
      .from("telegram_cart")
      .update({ status, items, total })
      .eq("user_id", userId)
      .eq("vendor_id", vendorId)
      .eq("status", "active");
    if (error) console.error("upsertCart status update error:", error.message);
  }
}

export async function getOrderContext(orderId: number): Promise<{ telegramId: number; vendorId: number } | null> {
  const { data, error } = await supabase
    .from("telegram_orders")
    .select("user_id, vendor_id")
    .eq("id", orderId)
    .single();
  if (error || !data) return null;
  return { telegramId: data.user_id, vendorId: data.vendor_id };
}

export async function savePickupCode(orderId: number, pickupCode: string, rideType: string) {
  const { error } = await supabase
    .from("telegram_orders")
    .update({ pickup_code: pickupCode, ride_type: rideType })
    .eq("id", orderId);
  if (error) throw error;
}

export async function getOrderForEscrow(orderRef: string) {
  const { data: order, error: oErr } = await supabase
    .from("telegram_orders")
    .select("id, subtotal, delivery_fee, ride_type, pickup_code, status, vendor_id")
    .eq("order_ref", orderRef)
    .single();
  if (oErr || !order) throw new Error("Order not found");

  const { data: vendor, error: vErr } = await supabase
    .from("telegram_vendor")
    .select("name, acct_details")
    .eq("id", order.vendor_id)
    .single();
  if (vErr || !vendor) throw new Error("Vendor not found");

  return {
    order: order as {
      id: number; subtotal: number; delivery_fee: number;
      ride_type: string; pickup_code: string; status: string; vendor_id: number;
    },
    vendor: vendor as {
      name: string;
      acct_details: { bank_account_number: string; bank_code: string };
    },
  };
}

// ---------- Ratings ----------

export async function insertRating(
  userId: number,
  vendorId: number,
  orderId: number,
  rating: number,
) {
  const { error } = await supabase
    .from("telegram_vendor_ratings")
    .upsert(
      { user_id: userId, vendor_id: vendorId, order_id: orderId, rating },
      { onConflict: "user_id,order_id" },
    );
  if (error) throw error;
}

export async function getVendorAverageRating(vendorId: number): Promise<{ average: number; count: number }> {
  const { data, error } = await supabase
    .from("telegram_vendor_ratings")
    .select("rating")
    .eq("vendor_id", vendorId);
  if (error) throw error;
  if (!data || data.length === 0) return { average: 0, count: 0 };
  const average = data.reduce((sum, r) => sum + r.rating, 0) / data.length;
  return { average: Math.round(average * 10) / 10, count: data.length };
}

// ---------- Dev mode ----------

// Scatters fake drivers within ~2km of a point so Ride-hailing's
// preflight check (which requires drivers within 5km) finds enough riders.
export async function insertFakeDriversNear(
  lat: number,
  lng: number,
  vehicleType: "EV" | "Bike",
  count: number = 3,
) {
  const fakeDrivers = Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * 2 * Math.PI;
    const radiusKm = Math.random() * 2;
    const dLat = (radiusKm / 111) * Math.cos(angle);
    const dLng =
      (radiusKm / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);

    const id = crypto.randomUUID();
    return {
      driver_id: id,
      driver_pubkey: {},
      name: `Dev Fake Rider ${i + 1}`,
      email: `fake-rider-${id}@dev.local`,
      phone: "0000000000",
      status: "available",
      driver_location: { lat: lat + dLat, lng: lng + dLng },
      vehicle_type: vehicleType,
      driver_response: {},
    };
  });

  const { error } = await supabase.from("back_drivers").insert(fakeDrivers);
  if (error) throw error;

  return fakeDrivers.map((d) => d.driver_id);
}

export async function deleteFakeDriversByIds(driverIds: string[]) {
  if (driverIds.length === 0) return;
  const { error } = await supabase
    .from("back_drivers")
    .delete()
    .in("driver_id", driverIds);
  if (error) throw error;
}

export async function getPaymentByReference(reference: number) {
  const { data, error } = await supabase
    .from("telegram_payments")
    .select("zazu_sub_name")
    .eq("id", reference)
    .single();
  if (error || !data) throw error;
  return data;
}
