import { supabase } from "./supabase";
import { Category } from "../types";

// ---------- Vendor ----------

export async function getVendorById(vendorId: string) {
  const { data, error } = await supabase
    .from("vendor")
    .select("*")
    .eq("id", vendorId)
    .single();
  if (error) throw error;
  return data;
}

export async function getCategoriesWithItems(vendorId: string) {
  const { data, error } = await supabase
    .from("categories")
    .select(
      `
      id,
      name,
      item (
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
  return data as Category[];
}

// ---------- Orders ----------

export async function insertOrder(order: {
  user_id: number;
  vendor_id: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: string;
}) {
  const { data, error } = await supabase
    .from("orders")
    .insert(order)
    .select("*")
    .single();
  if (error || !data)
    throw new Error("Failed to create order: " + error?.message);
  return data;
}

export async function getOrderById(orderId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId);
  if (error || !data) throw new Error("Order not found: " + error?.message);
  return data;
}

export async function updateOrderStatus(orderId: string, status: string) {
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId);
  if (error) throw error;
}

// ---------- Payments ----------

export async function insertPayment(payment: {
  order_id: string;
  paystack_ref: string;
  amount: number;
  status: string;
}) {
  const { data, error } = await supabase
    .from("payments")
    .insert(payment)
    .select("*")
    .single();
  if (error || !data)
    throw new Error("Failed to create payment: " + error?.message);
  return data;
}

export async function updatePaystackRef(orderId: string, paystackRef: string) {
  const { error } = await supabase
    .from("payments")
    .update({ paystack_ref: paystackRef })
    .eq("order_id", orderId);
  if (error) throw error;
}

export async function updatePaymentStatus(
  orderId: string,
  paystackRef: string,
  status: string,
) {
  const { error } = await supabase
    .from("payments")
    .update({ status })
    .eq("order_id", orderId)
    .eq("paystack_ref", paystackRef);
  if (error) throw error;
}

export async function getPaymentStatus(orderId: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("status")
    .eq("order_id", orderId)
    .single();
  if (error) throw error;
  return data;
}

export async function getPaymentByReference(reference: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("zazu_sub_name")
    .eq("id", reference)
    .single();
  if (error || !data) throw error;
  return data;
}
