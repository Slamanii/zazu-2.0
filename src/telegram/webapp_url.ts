import { PUBLIC_URL } from "../env";

// Telegram only opens Mini Apps over HTTPS.
export const WEB_APP_ENABLED = /^https:\/\//.test(PUBLIC_URL);

// The pages a bot's Menu button opens: a vendor's menu, or (vendorId null) the marketplace.
export function webAppUrl(vendorId: number | null): string {
  const base = PUBLIC_URL.replace(/\/+$/, "");
  return vendorId == null ? `${base}/market.html` : `${base}/index.html?vendorId=${vendorId}`;
}
