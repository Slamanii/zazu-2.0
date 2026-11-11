export const DEV_MODE = process.env.DEV_MODE === "true";

export const SUPABASE_URL = "https://edtsmqjnkakaaujmmhip.supabase.co";

export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

export const PAYSTACK_SECRET_KEY =
  "sk_test_d375c669a48bd40529125830f6d401ce5c14d95f";

export const PAYSTACK_PUBLIC_KEY =
  "pk_test_47543ec7ca9fa469eddb38211984c63dfa6219c3";

export const NGROK_AUTHTOKEN =
  "2o10fY0VwunBigvhWJHIVzPLPu7_2QPodTpkoy2qCsgsSyCkU";

export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export const ASAP_BASE_URL =
  process.env.ASAP_BASE_URL ?? "http://127.0.0.1:8081";
export const ASAP_WEBHOOK_SECRET = process.env.ASAP_WEBHOOK_SECRET ?? "";
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
export const INTERNAL_URL = process.env.INTERNAL_URL ?? "http://localhost:4000";
export const PUBLIC_URL =
  process.env.PUBLIC_URL ?? "https://18-130-60-168.sslip.io";
// The base URL the ASAP backend calls back on (/order-status, /ride-details, /driver-arrived),
// registered with POST /drivers/register-zazu-url. Defaults to PUBLIC_URL.
export const ZAZU_CALLBACK_URL = process.env.ZAZU_CALLBACK_URL ?? PUBLIC_URL;
// How many times Zazu asks for a new driver search after no_driver before giving up on an
// order. 0 (the default) keeps retrying until a driver takes it; the backend sets no limit.
export const NO_DRIVER_MAX_RETRIES = Number(process.env.NO_DRIVER_MAX_RETRIES ?? 0) || 0;

// Zazu's cut of each delivery fee; the driver is paid the rest. One variable per ride type:
//   ZAZU_CUT_<RIDE_TYPE>        the driver rides their own vehicle
//   ZAZU_CUT_<RIDE_TYPE>_ASSET  the driver is on an investor-funded vehicle (asset_trip)
//   ZAZU_CUT_DEFAULT            a ride type with no variable of its own
// An _ASSET variable falls back to its ride type's, so a new ride type needs at most two lines.
// Each is a fraction from 0 to 1; a bad value stops startup rather than paying the wrong amount.
const CUT_DEFAULTS: Record<string, number> = {
  ASAPEXPRESS_ASSET: 0.5,
  ASAPEXPRESS: 0.3,
  ASAP: 0.3,
  DEFAULT: 0.3,
};

const ZAZU_CUTS: Record<string, number> = { ...CUT_DEFAULTS };
for (const [name, raw] of Object.entries(process.env)) {
  if (!name.startsWith("ZAZU_CUT_") || raw === undefined || raw.trim() === "") continue;
  const cut = Number(raw);
  if (!Number.isFinite(cut) || cut < 0 || cut > 1) {
    throw new Error(`${name} must be a fraction between 0 and 1, got "${raw}"`);
  }
  ZAZU_CUTS[name.slice("ZAZU_CUT_".length).toUpperCase()] = cut;
}

export function zazuCut(rideType: string, assetTrip: boolean): number {
  const type = rideType.toUpperCase();
  return (assetTrip ? ZAZU_CUTS[`${type}_ASSET`] : undefined) ?? ZAZU_CUTS[type] ?? ZAZU_CUTS.DEFAULT;
}
