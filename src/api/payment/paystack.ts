import axios from "axios";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY!;

export async function createPaystackLink(
  order: {
    id: string;
    total: number;
    userId: number;
    email: string;
  },
  paystack_ref: string,
) {
  const res = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      amount: order.total * 100, // kobo
      email: `user${order.email}`, //treat
      reference: order.id,
      metadata: {
        user_id: order.userId,
        order_id: order.id,
      },
      callback_url: "https://abcd1234.ngrok-free.app/paystack/return",
    },
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
    },
  );

  return res.data.data.authorization_url;
}
