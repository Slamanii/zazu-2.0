# Zazu server operations

## Current deployment

- Repository: `https://github.com/Slamanii/zazu-2.0.git`, branch `main`.
- Checkout: `/home/ubuntu/Projects/zazu-2.0`.
- Service: `zazu.service`, running as `ubuntu` with `node dist/index.js`.
- HTTP port: 4000, fronted by nginx.
- Server environment: `/home/ubuntu/Projects/zazu-2.0/.env` (gitignored).
- Local SSH settings: `ZAZU_VPS_IP_ADDRESS`, `ZAZU_VPS_IP_USERNAME`, and
  `ZAZU_VPS_IP_PASSWORD` in the developer's root `.env`.

Use the address and username from your private environment file with SSH. Enter
passwords at the prompt rather than including them in shell commands. These
connection variables are not read by the bot application.

## Service installation and manual deployment

For a new host, install Node.js, npm, Git, and the service definition:

```bash
cd /home/ubuntu/Projects/zazu-2.0
sudo install -m 644 linux_server_config/zazu.service /etc/systemd/system/zazu.service
sudo systemctl daemon-reload
sudo systemctl enable zazu
bash linux_server_config/deploy.sh
```

Configure the private `.env` before starting. The deployment script fetches
GitHub, hard-resets tracked files to `origin/main`, installs dependencies,
builds, and restarts the service. Preserve any intentional local source edits
before running it. Ignored environment files remain on the server.

## Automatic GitHub updates

The current host uses cron polling, not a GitHub webhook. The following script
was installed outside the checkout at `/home/ubuntu/bin/update-zazu.sh`:

```bash
#!/bin/bash
set -euo pipefail
exec 9>"$HOME/.cache/zazu-update.lock"
flock -n 9 || exit 0
cd /home/ubuntu/Projects/zazu-2.0
git fetch origin main
latest=$(git rev-parse origin/main)
marker="$HOME/.cache/zazu-deployed"
if [[ -f "$marker" && "$(cat "$marker")" == "$latest" ]]; then
  exit 0
fi
bash linux_server_config/deploy.sh
echo "$latest" > "$marker"
```

To reproduce it, create `~/bin` and `~/.cache`, save the script, make it executable
with `chmod +x ~/bin/update-zazu.sh`, and add this line using `crontab -e`:

```cron
* * * * * /home/ubuntu/bin/update-zazu.sh >> /home/ubuntu/.cache/zazu-update.log 2>&1
```

Cron must be running. The deployment user needs noninteractive permission to
restart and inspect `zazu` with sudo. A lock prevents overlapping runs. The
marker advances only when the deployment script succeeds; failed updates retry
on the next minute. The script and crontab live outside Git and must be installed
separately on a replacement server.

The current script builds in the running checkout and checks immediate service
status. It does not provide an isolated release build, end-to-end health checks,
automatic rollback, or log rotation. Review logs after deployments.

## Check, start, stop, and troubleshoot

```bash
sudo systemctl status zazu --no-pager
sudo journalctl -u zazu -n 50 --no-pager
curl -I http://127.0.0.1:4000/
crontab -l
tail -n 50 ~/.cache/zazu-update.log
cat ~/.cache/zazu-deployed
git -C /home/ubuntu/Projects/zazu-2.0 log -1 --oneline
```

```bash
sudo systemctl start zazu
sudo systemctl restart zazu
sudo systemctl stop zazu
```

Stopping Zazu stops all its Telegram bots. To keep it stopped across future
GitHub changes, also suspend the cron entry; otherwise a new commit will restart
it. Service enablement also starts it after a server reboot.

For Telegram 401 errors, check the affected row's `bot_token` in Supabase.
For a silent main bot, check `is_active`, `ZAZU_MAIN_BOT_ID`, and the running
commit. Changes to bot rows refresh every 30 seconds; environment changes need
a service restart. Do not print tokens or private environment files into logs.
