# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through [GitHub's private vulnerability reporting](https://github.com/ysabelkm/catchup-group-bot/security/advisories/new).

Include what you found, how to reproduce it and what an attacker could do with it. You'll get a reply within a few days. Once a fix is out, you'll be credited unless you'd rather not be.

## In scope

- Anything that lets someone see a group's items without being a member of that group
- Bypassing the admin or class-rep checks on `/due`, `/remove`, `/editors`, `/settings` or `/setup`
- Calling `/cron/daily` or the webhook without the right secret
- Leaking bot tokens, secrets or stored messages

## If you self-host

- Keep `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET` and `DATABASE_URL` in your host's secret store. Never commit them.
- If a token leaks, revoke it straight away with @BotFather (`/revoke`) and update your deployment.
