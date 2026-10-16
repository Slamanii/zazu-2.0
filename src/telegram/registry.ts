import TelegramBot from "node-telegram-bot-api";
import { supabase } from "../db/supabase";
import { attachVendorHandlers } from "./zazu_vendor_acct";
import { attachMainHandlers } from "./zazu_main_client";

type ManagedBot = {
  id: number; bot_id: number | string | null; bot_token: string;
  vendor_id: number | null; is_active: boolean;
};
type RunningBot = { bot: TelegramBot; token: string; vendorId: number | null };
const running = new Map<number, RunningBot>();
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;
let stopping = false;

export function getVendorBot(vendorId: number): TelegramBot {
  for (const entry of running.values()) {
    if (entry.vendorId === Number(vendorId)) return entry.bot;
  }
  throw new Error(`No active Telegram bot for vendor ${vendorId}`);
}

function isMain(row: ManagedBot): boolean {
  return !!process.env.ZAZU_MAIN_BOT_ID &&
    (String(row.bot_id) === process.env.ZAZU_MAIN_BOT_ID ||
      row.bot_token.split(":")[0] === process.env.ZAZU_MAIN_BOT_ID);
}

async function stopEntry(id: number, entry: RunningBot) {
  await entry.bot.stopPolling({ cancel: true });
  entry.bot.removeAllListeners();
  running.delete(id);
  console.log(`[bots] Stopped managed bot ${id}`);
}

export async function refreshBots() {
  if (refreshing || stopping) return;
  refreshing = true;
  try {
    const rows: ManagedBot[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("telegram_bots")
        .select("id, bot_id, bot_token, vendor_id, is_active")
        .order("id").range(offset, offset + 499);
      if (error) throw new Error(`Bot discovery failed (${error.code ?? "database error"})`);
      rows.push(...(data as ManagedBot[]));
      if (data.length < 500) break;
    }
    const desired = new Map(rows.filter(row => row.is_active && row.bot_token &&
      (row.vendor_id != null || isMain(row))).map(row => [row.id, row]));
    for (const [id, entry] of running) {
      const row = desired.get(id);
      if (!row || row.bot_token !== entry.token || row.vendor_id !== entry.vendorId) {
        await stopEntry(id, entry);
      }
    }
    for (const row of desired.values()) {
      if (stopping || running.has(row.id)) continue;
      if (row.vendor_id != null && [...running.values()].some(e => e.vendorId === row.vendor_id)) {
        console.error(`[bots] Skipping duplicate active bot for vendor ${row.vendor_id}`);
        continue;
      }
      const bot = new TelegramBot(row.bot_token, { polling: false });
      bot.on("polling_error", (err: any) => {
        console.error(`[bots] Bot ${row.id} polling error (${err.response?.statusCode ?? err.code ?? "unknown"})`);
      });
      let stage = "Telegram authentication";
      try {
        const me = await bot.getMe();
        const identity = String(row.bot_id ?? "").replace(/^@/, "");
        if (identity && identity !== String(me.id) && identity.toLowerCase() !== me.username?.toLowerCase()) {
          throw new Error("Bot identity mismatch");
        }
        stage = "handler registration";
        if (isMain(row)) attachMainHandlers(bot);
        else attachVendorHandlers(bot, Number(row.vendor_id));
        stage = "command registration";
        await bot.setMyCommands([
          { command: "start", description: "Get started" },
          { command: "menu", description: "Browse the menu" },
          { command: "cart", description: "View your cart" },
          { command: "location", description: "Update delivery location" },
        ]);
        if (stopping) { bot.removeAllListeners(); break; }
        running.set(row.id, { bot, token: row.bot_token, vendorId: row.vendor_id });
        void bot.startPolling().catch(() => console.error(`[bots] Bot ${row.id} polling stopped`));
        console.log(`[bots] Started @${me.username} (managed bot ${row.id}, vendor ${row.vendor_id ?? "main"})`);
      } catch (err: any) {
        bot.removeAllListeners();
        console.error(`[bots] Could not start managed bot ${row.id} during ${stage} (${err.response?.statusCode ?? err.code ?? err.name ?? "unknown"})`);
      }
    }
    console.log(`[bots] Supabase sync: ${running.size} running, ${desired.size} eligible`);
  } finally { refreshing = false; }
}

export async function startBotRegistry() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required on the server");
  }
  await refreshBots();
  timer = setInterval(() => {
    void refreshBots().catch(() => console.error("[bots] Supabase refresh failed; keeping current bots until the next refresh"));
  }, 30_000);
}

export async function stopBotRegistry() {
  stopping = true;
  if (timer) clearInterval(timer);
  await Promise.all([...running].map(([id, entry]) => stopEntry(id, entry)));
}
