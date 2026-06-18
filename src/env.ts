export const ZAZU_MAIN_BOT = "8521586068:AAGTL6ymUHXKwSL6WV9s1XUqsb-mv_zU128";
export const VENDOR_BOT = "8589823390:AAE56F5jcl_JXwJyX_MjDqD70vb4D-X4gwQ";

// Dev-only bot tokens, polled instead of the live tokens above when DEV_MODE
// is on, so local development never steals updates from the live server.
export const VENDOR_BOT_DEV = "8817157876:AAHfz4vMGgGS0OQwfXPgMTcU8ncdtIc6Zik";
export const ZAZU_MAIN_BOT_DEV = "REPLACE_WITH_DEV_BOTFATHER_TOKEN";
export const SUPABASE_URL = "https://edtsmqjnkakaaujmmhip.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkdHNtcWpua2FrYWF1am1taGlwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTQzNDk0MSwiZXhwIjoyMDc3MDEwOTQxfQ.vRZZE1pZ5koj3cxoRPtxgUPlO7I1ZrOP-Mk_2dMfKx8";

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

export const DEV_MODE = process.env.DEV_MODE === "true";
