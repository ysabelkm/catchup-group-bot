# CatchUp

**A Telegram bot that reads your class group so you don't have to.**

[![CI](https://github.com/ysabelkm/catchup-group-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/ysabelkm/catchup-group-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](.nvmrc)

Class group chats move fast. Assignments, deadlines, slides and lecturer tips get buried under hundreds of "ok 😂" messages, adverts and birthday wishes. Students who are offline for a day, or have no data on campus, come back to a wall of unread messages and miss deadlines.

CatchUp sits in the group and reads every topic. It picks out the **assignments, tasks, projects, notes and tips**, and posts one clean summary every evening at **7 PM**.

```
📚 Daily summary — Mon 9 Nov

⏰ Due soon
• CSC 411 – Assignment 2 — due TOMORROW (Tue 10 Nov) · #Assignments ↗
• MIS 402 – Group project proposal — due Fri 13 Nov · #General ↗

🔄 Ongoing (no due date stated)
• COS 411 – Reading task — posted Thu 5 Nov (shows until Thu 12 Nov) ↗

🆕 New today
• 📝 Note: HCI Week 9 slides · #Resources ↗
• 💡 Tip: Focus on chapters 3–5 for the test ↗
```

Each ↗ jumps straight to the original message.

## Features

- **Reads every forum topic**, not just one, and links each item back to its source message.
- **Understands how students write**: course codes (`csc411`, `CSC-411`, `CSC 411`), abbreviations (`ass 2`), Nigerian Pidgin ("una should submit…", "deadline don shift") and day-first dates ("20th Nov", "next week Tuesday", "next tomorrow").
- **Filters the noise**: small talk, stickers, student questions, adverts ("we do your assignments, DM 080…"), and social events (fellowship, parties, campaigns).
- **Follows updates**: "CSC 411 deadline extended to Monday" or a reply saying "Deadline for this is 27 Nov" updates the existing item instead of creating a duplicate.
- **Never skips a day**: if the server was asleep at 7 PM, the summary is sent as soon as it wakes. Anything that came due in between is listed under "Was due since the last summary".
- **Corrections by trusted people**: admins and class reps can fix a due date (`/due 25 Nov 2pm`) or remove a wrong item (`/remove`) by replying to it.
- **Personal catch-up in DM**: `/catchup` shows everything since you last checked, across all your class groups. Members can also opt in to get the daily summary by DM.
- **Private by design**: membership is checked live, so only real group members see a group's items. Message text, links and file names are wiped after 30 days.

## Commands

**In the group**

| Command | Who | What it does |
| --- | --- | --- |
| `/setup` | Admins | Turn CatchUp on. Send it inside the topic where summaries should be posted. |
| `/summary` | Everyone | Preview today's summary so far. Members are limited to one every 2 minutes. |
| `/items` | Everyone | List everything still active: due soon, ongoing, notes and tips. |
| `/due <date>` | Admins, class reps | Reply to an item's message (or a summary) to set its due date. Manual dates always win. |
| `/remove` | Admins, class reps | Reply to an item's message to remove it. |
| `/editors` | Admins | `/editors add` or `/editors remove` (as a reply) to manage class reps. `/editors` lists them. |
| `/settings` | Admins | Toggle summaries, whether to post on empty days, and how long notes and tips stay. |
| `/privacy` | Everyone | What is stored and for how long. |

**In a private chat with the bot**

| Command | What it does |
| --- | --- |
| `/start` | Welcome message, plus a button to get the daily summary by DM. |
| `/catchup` | Everything new since your last `/catchup`, across all your groups. |
| `/items` | All active items in your groups. |
| `/summary` | Today's summary so far, across your groups. |
| `/settings` | Turn DM summaries on or off. |

## How it works

```
Telegram ──webhook──▶ HTTP server ──▶ grammY bot
                                         │
                       ┌─────────────────┼───────────────────┐
                       ▼                 ▼                   ▼
                  store message    rule-based extraction   commands
                  (every topic)    prefilter → classify →  (/due, /items…)
                       │           dates → title → update?
                       └────────────▶ Postgres ◀──────────────┘
                                         ▲
  cron-job.org ── 7 PM ──▶ /cron/daily ──┘  build + post summary, then DMs
```

1. **Ingest.** Every group message is stored with its topic. Commands and service messages are skipped, and edits are re-processed.
2. **Extract.** [`src/extraction`](src/extraction) runs a fast rule-based pipeline:
   - A prefilter drops chatter.
   - A classifier picks a type from keyword sets, course codes and file types. Adverts need two or more independent ad signals and no course code, so "CSC 411 manual is N500, pay the class rep" still counts.
   - [chrono-node](https://github.com/wanasit/chrono) resolves dates in the group's timezone, with extra normalisation for local phrasing.
3. **Update or create.** A message that looks like an update is matched to an existing item, first by reply, then by the same course code within 21 days. Dates set with `/due` are never overwritten.
4. **Lifecycle.** Dated items expire at the end of their due day. Undated tasks stay for 7 days. Notes and tips appear once, or for 7 days if the group chooses that in `/settings`.
5. **Summarise.** An idempotent `SummaryLog` claim guarantees one summary per group per day, even with retries, restarts or several triggers. Each Telegram update is processed exactly once (`ProcessedUpdate`).

The full product and design spec, including the decisions made along the way, is in [`docs/CATCHUP_BOT_SPEC.md`](docs/CATCHUP_BOT_SPEC.md).

## Tech stack

[TypeScript](https://www.typescriptlang.org/) · [Node.js 22+](https://nodejs.org/) · [grammY](https://grammy.dev/) · [Prisma](https://www.prisma.io/) + PostgreSQL · [Luxon](https://moment.github.io/luxon/) · [chrono-node](https://github.com/wanasit/chrono) · [Zod](https://zod.dev/) · [pino](https://getpino.io/) · [Vitest](https://vitest.dev/)

## Running it yourself

### 1. Create a bot

1. Message [@BotFather](https://t.me/BotFather) and send `/newbot`. Keep the token secret.
2. Send `/setprivacy`, pick your bot and choose **Disable**. Without this, bots in groups only see commands, not normal messages.
3. Optional: `/setjoingroups` to control who can add it.

### 2. Run locally

You need Node.js 22+ and PostgreSQL.

```bash
git clone https://github.com/ysabelkm/catchup-group-bot.git
cd catchup-group-bot
npm install
cp .env.example .env        # then fill in TELEGRAM_BOT_TOKEN and DATABASE_URL
createdb catchup_bot
npm run db:migrate          # create the tables
npm run dev                 # long-polling mode, restarts on change
```

Add the bot to a test group with **Topics** enabled, send `/setup`, and post a few messages.

> A bot token can only be used by one running instance at a time. If the same bot is deployed, stop it, or use a second bot for local development.

### 3. Deploy for free

The bot runs on free tiers: [Render](https://render.com) (web service), [Neon](https://neon.tech) (Postgres) and [cron-job.org](https://cron-job.org) (scheduler).

1. **Database:** create a Neon project and copy its connection string.
2. **App:** on Render, choose **New → Blueprint** and point it at your fork. [`render.yaml`](render.yaml) sets up the service. When asked, enter `TELEGRAM_BOT_TOKEN` and `DATABASE_URL`. `TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` are generated for you. Migrations run automatically on every start, and the webhook is registered on boot.
3. **Daily trigger:** on cron-job.org, create a job that sends `POST https://<your-app>.onrender.com/cron/daily` every day at 19:00 in your timezone, with the header `Authorization: Bearer <CRON_SECRET>`. Copy the secret from Render's Environment tab.
4. **Keep-alive:** free Render services sleep after 15 minutes idle. Add a second job that sends `GET /health` every 10 minutes. Even without it, a missed summary is sent late, never skipped.

### Configuration

All settings are environment variables, validated at startup ([`src/config.ts`](src/config.ts)). See [`.env.example`](.env.example) for the full list.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | | From @BotFather |
| `DATABASE_URL` | Yes | | PostgreSQL connection string |
| `BOT_MODE` | | `polling` | `polling` for local dev, `webhook` in production |
| `PUBLIC_BASE_URL` | Webhook mode | `RENDER_EXTERNAL_URL` | Public HTTPS URL of the server |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook mode | | Any string. It is hashed into Telegram's allowed format. |
| `CRON_SECRET` | Webhook mode | | Bearer token for `/cron/daily` |
| `SUMMARY_TIME` | | `19:00` | Local time of the daily summary |
| `DEFAULT_TIMEZONE` | | `Africa/Lagos` | IANA timezone for new groups |
| `BOT_OWNER_TELEGRAM_ID` | | | Your numeric Telegram ID, for failure alerts. Press Start on the bot first. |
| `RAW_MESSAGE_RETENTION_DAYS` | | `30` | Days before message text, links and file names are wiped |
| `BOT_PAUSED` | | `false` | Kill switch: stops summaries |
| `LOG_LEVEL` | | `info` | pino log level |

### HTTP endpoints

| Route | Purpose |
| --- | --- |
| `POST /telegram/webhook` | Telegram updates. Checked against the secret-token header. |
| `GET /health` | Liveness plus a database check |
| `POST /cron/daily` | Runs pending extraction, item expiry, the retention cleanup and due summaries. Needs `Authorization: Bearer $CRON_SECRET`. Returns `202` immediately. |

## Development

```bash
npm run dev          # run with hot reload (polling)
npm run typecheck    # tsc --noEmit
npm test             # vitest (needs a migrated Postgres, see below)
npm run build        # prisma generate + tsc → dist/
npm run db:migrate   # create a migration after editing prisma/schema.prisma
```

The test suite has two parts:

- **Unit tests** for date parsing, extraction rules, lifecycle and rendering.
- **Integration tests** that feed fake Telegram updates through the real bot into Postgres. Telegram's API is faked, so no token or network is needed.

The integration tests use `DATABASE_URL` (default `postgresql://localhost:5432/catchup_bot`) and only touch rows with their own test chat IDs.

[GitHub Actions](.github/workflows/ci.yml) runs on every push and pull request against a fresh Postgres 16, on Node 22 and 24. It runs the migrations, checks that the Prisma schema has no drift from them, typechecks, tests and builds.

### Project layout

```
src/
  index.ts           entry point: webhook server or long polling
  server.ts          HTTP routes (webhook, /health, /cron/daily)
  bot.ts             grammY setup, middleware order, command menus
  config.ts          environment validation (Zod)
  handlers/          ingest, membership, commands, corrections, admin, personal (DM)
  extraction/        rules.ts, dates.ts, extract.ts, pipeline.ts, lifecycle.ts
  summary/           build, render, send (group), dm, personal (/catchup)
  services/          groups, users, items, roles, item edits
  lib/               Telegram helpers, links, permissions, texts
  jobs/daily.ts      the 7 PM job
prisma/              schema and migrations
test/                unit and integration tests
```

## Privacy

CatchUp stores group messages so it can extract and link items. Every day, messages older than `RAW_MESSAGE_RETENTION_DAYS` (default 30) have their text, links, file name and sender wiped. Only the message ID and timestamp are kept, so the ↗ links in items still work. Extracted items (title, short summary, due date) are kept while the group uses the bot.

- Items are only shown to people who are currently members of the group. This is checked live with Telegram.
- Students can see exactly what is stored with `/privacy`.
- If you deploy your own instance, you are responsible for telling your group that the bot is reading messages, and for complying with local data-protection law (for example the NDPA in Nigeria or the GDPR in the EU).

## Roadmap

- [ ] Optional AI extraction (Groq or Gemini) for messages the rules can't classify, with personal data redacted first
- [ ] An evaluation set of real (anonymised) messages to measure extraction accuracy
- [ ] Per-group summary time and timezone

## Contributing

Contributions are welcome, especially **examples of messages the bot gets wrong**. Each one becomes a test case and a better rule. Open a [missed message report](https://github.com/ysabelkm/catchup-group-bot/issues/new?template=missed_message.yml), or see [CONTRIBUTING.md](CONTRIBUTING.md) to send code.

## License

[MIT](LICENSE) © 2026 Ysabel Ezeani
