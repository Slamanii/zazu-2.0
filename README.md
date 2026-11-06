# Zazu

Telegram marketplace and vendor bots backed by Supabase, with an Express API for payment and delivery integrations.

## Database and environment

The current shared Supabase project is `edtsmqjnkakaaujmmhip`:
`https://edtsmqjnkakaaujmmhip.supabase.co`.
Database operations use the server Supabase client in `src/db/supabase.ts`.
Bot credentials are read from `public.telegram_bots`, not from a single Telegram token in `.env`.

Keep local settings in the gitignored root `.env`. See
[the environment example](linux_server_config/.env.example) for variable names.
Never commit real passwords, bot tokens, or Supabase secret keys.

| Setting | Purpose |
| --- | --- |
| `SUPABASE_URL` | Shared database project URL |
| `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` | Server-only access to protected bot tokens and database operations |
| `ZAZU_MAIN_BOT_ID` | Main bot's Telegram numeric ID or `bot_id` value; current value is `zazu_main_bot` |
| `ASAP_WEBHOOK_SECRET` | Shared secret for delivery API callbacks |
| `WEBHOOK_SECRET` | Signature verification for the optional GitHub webhook endpoint |
| `INTERNAL_URL` | Local Zazu API URL, normally `http://127.0.0.1:4000` |
| `PUBLIC_URL` | Public HTTPS base URL used in links |
| `ZAZU_VPS_IP_ADDRESS` | Local SSH connection setting |
| `ZAZU_VPS_IP_USERNAME` | Local SSH username |
| `ZAZU_VPS_IP_PASSWORD` | Local SSH password; not needed by the running app |

The server service loads `linux_server_config/.env` when present, then the root
`.env`. The current server also has a systemd drop-in loading the root `.env`.
Changing that file requires restarting the service.

## Managed Telegram bots

Active rows assigned to a vendor run with that vendor's handlers. Inactive,
deleted, or unassigned pool bots do not poll, except an explicitly selected main
bot. Changes are reconciled every 30 seconds, including token rotation and
vendor reassignment. Failed database refreshes retain current bots and retry.
Invalid Telegram tokens are isolated without logging their values.

The `bot_id` field may contain a Telegram numeric ID or username. Vendor routing
uses `vendor_id`, not the editable display name. Select the main bot with
`ZAZU_MAIN_BOT_ID` and set its database row's `is_active` to true.

Main bot commands:

- `/start`: welcome and marketplace instructions.
- `/help`: command help.
- `/search`: list active vendor bots.
- `/search <name>`: search vendors by name.

The main bot also handles payment deep links. Vendor bots handle menus, carts,
contact details, and delivery locations. Search displays up to 20 matching
vendors; it does not activate inactive vendor bots.

## Build and run

Use Node.js 20.6 or later for `--env-file` support.

```bash
npm ci
npm run build
node --test scripts/registry.test.js scripts/main-bot.test.js
node --env-file=.env dist/index.js
```

The HTTP server listens on port 4000. The existing `npm start` script points to
`index.js`; use the built command above or systemd for this deployment.

## Server deployment

See [server setup and automatic updates](linux_server_config/README.md).
The server tracks GitHub `Slamanii/zazu-2.0`, branch `main`. A cron job checks
for new commits every minute and rebuilds/restarts Zazu when the commit changes.

## Verification and current limits

On 4 November 2026, both `zazu_main_bot` and `zazu_vendor_1_bot` were confirmed
running, the server matched GitHub, and the first scheduled update completed.
Other bots only run when activated in Supabase.

This confirms bot connectivity and deployment, not the complete purchase and
delivery flow. The integration review identified Zazu/Rust order contract
mismatches: `order_id` versus `order_ref`, the required linked
`app_delivery_orders` row, asynchronous driver assignment, and pickup-code
ownership. Resolve and test these before treating delivery checkout as verified.
Temporary conversation state remains in server memory.
