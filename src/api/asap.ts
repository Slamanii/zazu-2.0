// Calls from Zazu to the ASAP backend. Every call carries the shared secret in x-asap-secret;
// without it the backend answers 401.
import axios, { AxiosError } from "axios";
import { ASAP_BASE_URL, ASAP_WEBHOOK_SECRET, ZAZU_CALLBACK_URL } from "../env";

const asap = axios.create({
  baseURL: ASAP_BASE_URL,
  timeout: 15_000,
  headers: { "x-asap-secret": ASAP_WEBHOOK_SECRET },
});

// What POST /riders/ride-request and /riders/assign-driver answer: the driver search started.
// The driver, the codes and the driver's bank details come later in /ride-details.
export type SearchStarted = {
  status: "success";
  order_id: number;
  estimated_price: number;
  estimated_arrival: string;
};

export class AsapError extends Error {
  constructor(public status: number | undefined, message: string) {
    super(message);
  }
}

function asAsapError(err: unknown): AsapError {
  const e = err as AxiosError<{ error?: string }>;
  const status = e.response?.status;
  const message = e.response?.data?.error ?? e.message;
  return new AsapError(status, status ? `ASAP answered ${status}: ${message}` : message);
}

export async function preflight(payload: unknown) {
  try {
    return (await asap.post("/drivers/ride-preflight", payload)).data;
  } catch (err) {
    throw asAsapError(err);
  }
}

// Places the order, once per order. Retries go through assignDriver, never through this.
export async function requestRide(payload: unknown): Promise<SearchStarted> {
  try {
    return (await asap.post<SearchStarted>("/riders/ride-request", payload)).data;
  } catch (err) {
    throw asAsapError(err);
  }
}

// The retry after a no_driver push: starts a new search with a wider radius.
// 409 means the order already has a driver or is closed; 403 that it is not a Zazu order;
// 404 that the backend has no order or ride request for this order_ref.
export async function assignDriver(orderRef: string): Promise<SearchStarted> {
  try {
    return (await asap.post<SearchStarted>("/riders/assign-driver", { order_ref: orderRef })).data;
  } catch (err) {
    throw asAsapError(err);
  }
}

// The backend keeps Zazu's URL in memory only, so it is lost whenever the backend restarts.
// Registered at startup and then every REGISTER_EVERY_MS so a backend restart is picked up.
const REGISTER_EVERY_MS = 10 * 60 * 1000;
let registerTimer: ReturnType<typeof setInterval> | undefined;

export async function registerZazuUrl(): Promise<boolean> {
  const url = ZAZU_CALLBACK_URL.replace(/\/+$/, "");
  try {
    await asap.post("/drivers/register-zazu-url", { url });
    console.log(`[asap] Registered Zazu URL ${url}`);
    return true;
  } catch (err) {
    console.error(`[asap] Could not register Zazu URL ${url}: ${asAsapError(err).message}`);
    return false;
  }
}

export function startZazuUrlRegistration() {
  if (registerTimer) return;
  void registerZazuUrl();
  registerTimer = setInterval(() => void registerZazuUrl(), REGISTER_EVERY_MS);
  registerTimer.unref();
}
