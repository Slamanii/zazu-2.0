// Checkout and the backend's preflight. The preflight picks the ride type and prices the
// delivery for one rider, route and set of items, and signs them into preflight_token; the ride
// request must send back exactly the same or the backend refuses it (409). So each order keeps
// what its preflight was run for, the ride request is built only from that, and the preflight is
// run again whenever the cart or the delivery location no longer matches it.
import { zazuId } from "../telegram/zazu_main_client";
import {
  OrderCheckout,
  getCart,
  getUserByTelegramId,
  getVendorForBot,
} from "../db/queries";
import { CartItem } from "../types";
import { preflight } from "./asap";

// The backend's package limits: at most 10 units and 5 kg per delivery.
export const MAX_DELIVERY_UNITS = 10;
const ITEM_WEIGHT_KG = 0.5;
const ITEM_DIMENSIONS_CM = [20.0, 15.0, 10.0];
const ITEM_TYPE = "Food & Groceries";

type Point = { lat: number; lng: number };

export type DeliveryItem = {
  name: string;
  price: number;
  dimensions: number[];
  quantity: number;
  weight: number;
  type: string;
};

// What the backend is told is being carried, for the preflight and the ride request alike: the
// token covers these exact values. price is the line's declared value (unit price x quantity),
// in naira. Menu items carry no size or weight, so a typical takeaway portion is assumed.
export function deliveryItems(cart: CartItem[]): DeliveryItem[] {
  return cart.map((item) => ({
    name: item.name,
    price: item.price * item.qty,
    dimensions: ITEM_DIMENSIONS_CM,
    quantity: item.qty,
    weight: ITEM_WEIGHT_KG,
    type: ITEM_TYPE,
  }));
}

export type Quote = {
  canServe: boolean;
  rideType: string;
  deliveryFee: number;
  token: string | null;
};

// The backend's answer for this route and these items. Zazu books every order as its own rider
// account (zazuId), and the token is signed for that rider, so the ride request must use it too.
export async function runPreflight(pickup: Point, dropoff: Point, items: DeliveryItem[]): Promise<Quote> {
  const answer = await preflight({ rider_id: zazuId, pick_up: pickup, drop_off: dropoff, items });
  return {
    canServe: answer.can_serve === true && !!answer.preflight_token,
    rideType: answer.ride_type,
    deliveryFee: Number(answer.estimated_price),
    token: answer.preflight_token ?? null,
  };
}

// The order's columns for a cart priced by a preflight that can serve it.
export function orderCheckout(cart: CartItem[], pickup: Point, dropoff: Point, quote: Quote): OrderCheckout {
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  return {
    subtotal,
    delivery_fee: quote.deliveryFee,
    total: subtotal + quote.deliveryFee,
    ride_type: quote.rideType,
    preflight_token: quote.token!,
    pickup_point: pickup,
    dropoff_point: dropoff,
    dispatch_items: deliveryItems(cart),
    items: cart.map((i) => ({ name: i.name, quantity: i.qty, price: i.price })),
  };
}

function itemsKey(items: DeliveryItem[]): string {
  return items
    .map((i) => [i.name.trim(), i.price, i.dimensions.join("x"), i.quantity, i.weight, i.type].join("|"))
    .sort()
    .join("\n");
}

function samePoint(a: Point | null | undefined, b: Point): boolean {
  return !!a && Number(a.lat) === b.lat && Number(a.lng) === b.lng;
}

export type PendingOrder = {
  id: number;
  user_id: number;
  vendor_id: number;
  status: string;
  preflight_token: string | null;
  pickup_point: Point | null;
  dropoff_point: Point | null;
  dispatch_items: DeliveryItem[] | null;
};

export type Resync =
  | { ok: true; checkout: OrderCheckout | null }
  | { ok: false; error: string };

// Run before the customer pays. If the cart, the delivery location or the store's location moved
// away from what the order's preflight was run for, the preflight is run again and the order is
// re-priced (checkout); null when the order still matches and nothing needs to change.
export async function resyncCheckout(order: PendingOrder): Promise<Resync> {
  const [cart, user, vendor] = await Promise.all([
    getCart(order.user_id, order.vendor_id),
    getUserByTelegramId(order.user_id),
    getVendorForBot(order.vendor_id),
  ]);

  const lines = cart?.items ?? [];
  if (lines.length === 0) {
    return { ok: false, error: "Your cart is empty. Add items and check out again." };
  }
  const units = lines.reduce((sum, i) => sum + i.qty, 0);
  if (units > MAX_DELIVERY_UNITS) {
    return { ok: false, error: `One delivery can carry up to ${MAX_DELIVERY_UNITS} items. Your cart has ${units}.` };
  }
  if (!user?.default_lat || !user?.default_lng) {
    return { ok: false, error: "Please share your delivery location in the chat, then check out again." };
  }

  const pickup = { lat: vendor.lat, lng: vendor.lng };
  const dropoff = { lat: user.default_lat, lng: user.default_lng };
  const items = deliveryItems(lines);

  const unchanged =
    !!order.preflight_token &&
    samePoint(order.pickup_point, pickup) &&
    samePoint(order.dropoff_point, dropoff) &&
    itemsKey(order.dispatch_items ?? []) === itemsKey(items);
  if (unchanged) return { ok: true, checkout: null };

  const quote = await runPreflight(pickup, dropoff, items);
  if (!quote.canServe) {
    return { ok: false, error: "No riders are available near you right now. Please try again in a few minutes." };
  }
  console.log(`[checkout] order=${order.id}: cart or location changed since checkout; preflight run again`);
  return { ok: true, checkout: orderCheckout(lines, pickup, dropoff, quote) };
}
