# Zazu

## Managed Telegram bots

The server reads bot tokens from Supabase `public.telegram_bots`. Set
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) in the
server-only `.env`. Never put the privileged key in frontend configuration.
The systemd service reads the root `.env` after `linux_server_config/.env`.

Active rows assigned to a vendor run with that vendor's handlers. Inactive,
deleted, or unassigned pool bots do not poll. Changes are reconciled every 30
seconds, including token rotation and vendor reassignment. Failed database
refreshes retain the current bots and retry on the next interval. Invalid
Telegram tokens are isolated and retried without logging secrets.

An optional separate main bot must also be stored in `telegram_bots`; select it
with `ZAZU_MAIN_BOT_ID` (Telegram numeric ID or bot_id value). Unassigned bots are otherwise kept
in the pool. Bot display names are not used to identify vendors. The bot_id field may hold a Telegram numeric ID or username.

Build with `npm ci && npm run build`. Run the built app with
`node --env-file=.env dist/index.js`, or install `linux_server_config/zazu.service`
and start it with systemd. Run `node --test scripts/registry.test.js` after a build.
