export const DEV_MODE = process.env.DEV_MODE === "true";

export const SUPABASE_URL = "https://edtsmqjnkakaaujmmhip.supabase.co";

export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

export const PAYSTACK_SECRET_KEY =
  "sk_test_d375c669a48bd40529125830f6d401ce5c14d95f";

export const PAYSTACK_PUBLIC_KEY =
  "pk_test_47543ec7ca9fa469eddb38211984c63dfa6219c3";

export const NGROK_AUTHTOKEN =
  "2o10fY0VwunBigvhWJHIVzPLPu7_2QPodTpkoy2qCsgsSyCkU";

export const ASAP_BASE_URL =
  process.env.ASAP_BASE_URL ?? "http://127.0.0.1:8081";
export const ASAP_WEBHOOK_SECRET = process.env.ASAP_WEBHOOK_SECRET ?? "";
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
export const INTERNAL_URL = process.env.INTERNAL_URL ?? "http://localhost:4000";
export const PUBLIC_URL =
  process.env.PUBLIC_URL ?? "https://18-130-60-168.sslip.io";
