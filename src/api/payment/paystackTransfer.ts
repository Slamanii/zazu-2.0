import axios from "axios";
import { PAYSTACK_SECRET_KEY } from "../../env";

const HEADERS = {
  Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
  "Content-Type": "application/json",
};

async function createRecipient(
  name: string,
  accountNumber: string,
  bankCode: string,
): Promise<string> {
  const res = await axios.post(
    "https://api.paystack.co/transferrecipient",
    { type: "nuban", name, account_number: accountNumber, bank_code: bankCode, currency: "NGN" },
    { headers: HEADERS },
  );
  return res.data.data.recipient_code;
}

export async function transferTo(
  name: string,
  accountNumber: string,
  bankCode: string,
  amountNaira: number,
  reason: string,
) {
  const recipientCode = await createRecipient(name, accountNumber, bankCode);
  await axios.post(
    "https://api.paystack.co/transfer",
    { source: "balance", amount: amountNaira * 100, recipient: recipientCode, reason },
    { headers: HEADERS },
  );
}
