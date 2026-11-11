# Catch-up Bot — Product & Technical Specification

**Owner:** Ysabel Ezeani
**Status:** Ready to build (v1)
**Stack:** Node.js + TypeScript, grammY, PostgreSQL + Prisma, Groq (Llama), Gemini (alternative)
**Timezone for everything user-facing:** `Africa/Lagos` (WAT, UTC+1)

> **Note to Claude Code:** This file is the source of truth for what the bot does. Items marked **⚠ DECISION PENDING** have a default. Use the default, but confirm with Ysabel before building that part. Ask before adding features not described here.

---

## 1. What the bot is

A Telegram bot that sits in busy university class groups, reads every message (across **all topics** in forum-style groups), and pulls out the **academic content** buried among the chatter: assignments, tasks, projects, notes and tips.

Every evening at **7:00 PM Lagos time** it posts a clean daily summary, so a student who missed hundreds of messages can see in one place what's due, what's ongoing and what was shared today.

### The problem it solves
- Class groups mix announcements, deadlines and study materials with greetings, jokes and side conversations.
- Groups are now split into multiple **topics**, so information is scattered.
- Students who are offline for long periods (e.g. no phones on campus, Wi-Fi only in some buildings) come back to hundreds of unread messages and miss deadlines.

---

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| **Group admin** | Telegram admins of the group | Add/remove the bot, run `/setup`, change settings, correct items |
| **Class rep / trusted editor** | Users the admin promotes via the bot | Correct due dates, delete wrong items |
| **Member** | Everyone in the group | Read summaries, use `/catchup` and `/items` |
| **Bot owner** | Ysabel | Global config, monitoring, kill switch |

---

## 3. What counts as "academic content"

The bot extracts these **item types**:

| Type | Examples | Has a due date? |
|---|---|---|
| `assignment` | "CSC 411 Assignment 2, submit on the portal by Friday" | Usually |
| `task` | "Everyone should read chapter 4 before Thursday's class", "fill the attendance form" | Sometimes |
| `project` | "Group project proposal due 20th Nov", "form groups of 5" | Usually |
| `note` | Shared slides, PDFs, links to materials, lecture notes, summaries | No |
| `tip` | Exam tips, "focus on chapters 3–5", "the lecturer likes diagrams" | No |

Everything else (greetings, jokes, memes, chit-chat, non-academic announcements) is **ignored**.

*(Possible later additions, NOT in v1 unless Ysabel asks: `test_exam`, `schedule_change` for venue/time changes.)*

---

## 4. Core behaviour

### 4.1 Reading messages (ingestion)
- The bot receives every message in groups it's added to, **from every topic** (`message_thread_id`).
- Store each message with: chat id, topic id + topic name, message id, sender id, timestamp, text/caption, reply-to message id, attachment metadata (file name/type, not the file itself).
- **Handle documents and links:** a PDF/slide with a caption, or a message with a link, is a likely `note`. Use the file name and caption.
- Edited messages: update the stored text and re-run extraction for that message.
- Must be **idempotent**: Telegram may resend updates, so de-duplicate on `update_id` / (chat_id, message_id).

### 4.2 Extracting items (AI pipeline)
For each batch of new messages:
1. **Pre-filter (cheap, no AI):** drop obviously irrelevant messages (stickers, very short messages like "ok", "😂", greetings). Keep anything with academic keywords, dates, course codes (e.g. `CSC 411`, `MIS402`), files or links.
2. **Redact personal data** before sending to any AI provider: replace phone numbers, emails and sender names with placeholders. Never send user IDs.
3. **Batch** about 20 messages per AI request. Include for each: an internal ref, the timestamp (Lagos time), the topic name, reply-to ref, and the text.
4. **AI returns strict JSON** (Groq JSON mode), validated with **Zod**. For each message: `is_academic`, `type`, `title` (short), `course_code` (if any), `summary` (1 line), `due_date_phrase` (exact words used, e.g. "next Friday"), `due_date_iso` (AI's resolved date or null), `due_time` (if stated), `updates_item_ref` (if this message changes an earlier item), `confidence`.
5. **Deterministic date check:** re-parse `due_date_phrase` with **chrono-node** using the message timestamp as the reference date in `Africa/Lagos`. If chrono and the AI disagree, prefer chrono for clear phrases, and mark the item `due_date_uncertain = true`.
6. **Merge / update:** if the message updates an existing item (reply to it, or same course code + similar title within the last 21 days, e.g. "deadline extended to Monday"), update that item instead of creating a duplicate. Keep a history of changes.
7. Invalid JSON → retry once → skip the batch and log it. Never crash the bot.

### 4.3 How the bot knows the due date
- Read it from the message text: "by Friday", "due 14th November", "next week Tuesday", "tomorrow 12pm".
- Resolve **relative dates against when the message was sent**, not when it was processed, in **Lagos time**.
- **Date without a time** = due at the **end of that day (23:59 WAT)**.
- If there are several dates in one message, the latest submission-type date wins. Ambiguous cases set `due_date_uncertain`.
- **Vague or no date** ("submit soon", "before the test") → `due_at = null` (see the 7-day rule below).
- **Later messages can change it** ("deadline extended to Monday") → update `due_at`, keep history.
- **Manual correction:** admins/class reps can reply to a summary or item with `/due 20 Nov` or `/due 20 Nov 2pm`. A manual date always wins over AI.

### 4.4 Item lifecycle (when items appear in the summary)

| Item | Shows in the daily summary… | Stops showing… |
|---|---|---|
| `assignment` / `task` / `project` **with a due date** | Every day from when posted until the due date | After the due date passes. On the due day it shows as **"due today"**; the next day it's gone |
| `assignment` / `task` / `project` **without a due date** | Every day for **7 days** after it was posted | After 7 days |
| `note` / `tip` | ⚠ **DECISION PENDING.** Default: **only once**, in the summary of the day it was posted | After that summary |

- If a due date is **added later** to an item that had none, switch it to the due-date rule.
- Items deleted by an admin/class rep never show again.
- If the original message is deleted in Telegram, keep the item but mark the source as unavailable.

### 4.5 The daily summary (7:00 PM WAT)
- Sent **every day at 19:00 Africa/Lagos** for each group with the bot enabled.
- **Where it's sent** — *decided by Ysabel, 9 Nov 2026*: posted **in the group**, and also **DM'd to members who opt in** (they press Start, then turn on "Daily summary by DM"). The DM combines all the user's groups, checked with `getChatMember`. A user who blocks the bot is opted out automatically.
- ⚠ **DECISION PENDING: which topic.** Default: the topic chosen during `/setup`; if none is chosen, the **General** topic.
- If there's nothing to report, send a short "No academic updates today ✅" (configurable: send or skip).
- Must cover messages from **all topics**, not just the topic the summary is posted in.

**If a summary is missed** (bot asleep, scheduler down, Telegram error) — *decided by Ysabel, 9 Nov 2026*:
- **Send late, never skip.** `SummaryLog` records each sent summary per group per day. Whenever the bot runs after 19:00 (the next cron call, an incoming message, the 18:55 wake-up) and today's summary isn't logged, it sends it then.
- **Nothing is lost.** Each item records whether it has appeared in a summary. "New today" means *new since the last summary that was actually sent*, so a missed day rolls into the next one. Notes/tips shown "once" are shown in the first summary that actually goes out.
- **Show deadlines that passed unseen.** If a deadline passed while no summary went out, the next summary lists it in a short **"⌛ Was due since the last summary"** section. This section only appears after a missed day.
- **Alert the owner.** A failed summary is reported to `BOT_OWNER_TELEGRAM_ID` on Telegram (cron-job.org also emails on a failed 7 PM call).

**Format (Telegram HTML):**

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

- Sort "Due soon" by due date (soonest first). Mark today and tomorrow clearly.
- Each item links (↗) to the original message. For forum topics use `https://t.me/c/<internal_chat_id>/<thread_id>/<message_id>`, where `internal_chat_id` is the chat id without the `-100` prefix; in non-topic groups use `https://t.me/c/<internal_chat_id>/<message_id>`.
- Flag uncertain dates with "(date unclear — check message)".
- Telegram's message limit is 4096 characters: split long summaries into several messages cleanly, without cutting an item in half.

### 4.6 Commands

| Command | Who | Where | What it does |
|---|---|---|---|
| `/start` | Anyone | Private chat | Welcome, explain the bot, privacy notice, opt in to DMs |
| `/setup` | Admin | Group | Enable the bot in this group, choose the summary topic, confirm settings |
| `/summary` | Anyone | Group or DM | Send today's summary now (rate-limited) |
| `/catchup` | Anyone | DM | Personal summary of everything since this user's last `/catchup` (only groups they're in) |
| `/items` | Anyone | Group or DM | List all currently active items |
| `/due <date> [time]` | Admin / class rep | Reply to an item or summary | Set or correct the due date |
| `/remove` | Admin / class rep | Reply to an item | Remove a wrong item |
| `/settings` | Admin | Group | Summary on/off, summary topic, "send when empty", note/tip rule |
| `/editors` | Admin | Group | Add/remove class reps (trusted editors) |
| `/privacy` | Anyone | Anywhere | Show what is stored and for how long |

**Who can correct due dates and remove items** — *decided by Ysabel, 9 Nov 2026*: **group admins + trusted editors (class reps) only**.

---

## 5. Technical design

### 5.1 Stack
- **Runtime:** Node.js (LTS) + **TypeScript** (strict mode)
- **Bot framework:** **grammY**, with plugins `@grammyjs/auto-retry` and `@grammyjs/transformer-throttler` (or a current equivalent) for Telegram flood limits
- **Database:** **PostgreSQL** (Neon or Supabase) with **Prisma**
- **Jobs / scheduling:** **pg-boss** (Postgres-backed, so no Redis needed) for the 19:00 summary, extraction batches and retries. Jobs must survive restarts.
- **Dates:** **Luxon** (timezone-safe) + **chrono-node** (natural-language date parsing)
- **Validation:** **Zod** for all AI output and config
- **AI providers (behind one interface `LLMProvider`):**
  - Primary: **Groq**, model `llama-3.3-70b-versatile`
  - Fallback / pre-filter: **Groq** `llama-3.1-8b-instant`
  - Alternative (dev/testing): **Google Gemini** (Flash model via AI Studio)
  - **Model names live in config/env, never hard-coded** (providers retire models)
- **Logging/monitoring:** pino logs + Sentry (or similar) for errors
- **Hosting:** Railway, Render or Fly.io (HTTPS required for webhooks)

### 5.2 Provider rules
- Groq free tier is the default. Handle `429 Too Many Requests` with backoff + retry, then fall back: **70B → 8B → rule-based extraction (chrono-node + keywords)**, so the bot never stops working.
- Track daily request counts per model and switch to 8B before hitting the 70B daily cap.
- **Gemini free tier: development/testing only, with fake or consenting data.** Google's free-tier terms say not to send personal information, and free-tier data may be used by Google. Use it with real group data only on a paid tier.
- Always redact personal data before any AI call (see 4.2).

### 5.3 Data model (Prisma, starting point)
- `Group`: telegram chat id, title, is_forum, enabled, summary_topic_id, settings (JSON), timezone (default Africa/Lagos)
- `Topic`: group, thread id, name
- `User`: telegram user id, first name, dm_opt_in, last_catchup_at
- `GroupMember`: user, group, role (`member` | `editor` | `admin`)
- `Message`: group, topic, telegram message id, sender, sent_at, text, reply_to_message_id, has_file, file_name, processed_at, deleted
- `Item`: group, type, title, course_code, summary, due_at (nullable), due_date_uncertain, due_source (`ai` | `rule` | `manual`), first_message_id, created_at, expires_at (computed), status (`active` | `expired` | `removed`)
- `ItemSource`: item ↔ messages that created or updated it
- `ItemChange`: history of due-date/title changes (who/what, old → new, when)
- `SummaryLog`: group, date, telegram message ids sent (prevents double-sending)
- `ProcessedUpdate`: telegram update_id (idempotency)

`expires_at` rules: due date → `due_at`; no due date → `created_at + 7 days`; note/tip → end of the posting day (default).

### 5.4 Telegram specifics (must handle)
- **Privacy mode must be OFF** (BotFather → `/setprivacy` → Disable), or the bot must be an admin, or it won't see normal messages. `/setup` should detect this and tell the admin.
- **Webhook mode in production** with the secret token header (`X-Telegram-Bot-Api-Secret-Token`); reject requests without it. Long polling is fine for local dev.
- **Forum topics:** read `message_thread_id` and topic names (from `forum_topic_created` / `forum_topic_edited` service messages). Post the summary into the chosen topic using `message_thread_id`.
- **Bots can't DM users who haven't pressed Start.** Handle the "Forbidden" error gracefully.
- **Rate limits:** roughly 30 messages/second overall and about 20 messages/minute per group. Queue and pace the 19:00 summaries across many groups.
- The bot was removed from a group / the group was migrated to a supergroup (chat id changes): handle `my_chat_member` and `migrate_to_chat_id`.

### 5.5 Configuration (env vars)
```
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
PUBLIC_BASE_URL=
DATABASE_URL=
LLM_PROVIDER=groq            # groq | gemini
GROQ_API_KEY=
GROQ_MODEL_PRIMARY=llama-3.3-70b-versatile
GROQ_MODEL_FALLBACK=llama-3.1-8b-instant
GEMINI_API_KEY=
GEMINI_MODEL=
SUMMARY_TIME=19:00
DEFAULT_TIMEZONE=Africa/Lagos
NO_DUE_DATE_DAYS=7
RAW_MESSAGE_RETENTION_DAYS=30
EXTRACTION_BATCH_SIZE=20
SENTRY_DSN=
BOT_OWNER_TELEGRAM_ID=
```

---

## 6. Privacy and safety
- When the bot joins a group, post a short notice: what it reads, why, how long data is kept, and how to remove it (`/privacy`).
- **Retention:** delete raw message text after `RAW_MESSAGE_RETENTION_DAYS` (default 30). Keep only extracted items (title, summary, dates, links).
- Never send phone numbers, emails, names or Telegram IDs to an AI provider.
- Only show a user `/catchup` results for groups they're actually a member of (check with `getChatMember`).
- Keep secrets in environment variables only; never commit `.env`.
- Nigeria Data Protection Act 2023 applies once real users' data is processed. Keep a simple written privacy policy.
- Owner kill switch: env/command to pause all AI calls and summaries.

---

## 7. Testing and quality
- **Unit tests (Vitest):**
  - date resolution: "tomorrow", "next Friday", "Friday" said on a Friday, "14th Nov", "by 12pm", a date with no time → 23:59 WAT, month/year rollover
  - lifecycle: due-date expiry, 7-day expiry, "due today" on the due day, a due date added later
  - summary formatting and 4096-character splitting
  - message links for topic vs non-topic groups
- **Evaluation set:** `eval/messages.jsonl` with about 100 realistic class-chat messages (including Pidgin, typos, topic messages, "same deadline as last week", extensions) and hand-labelled expected output. A script (`npm run eval`) reports precision/recall per type and due-date accuracy for each model (70B vs 8B vs rule-based). Rerun it whenever the prompt changes.
- **Integration test:** a fake Telegram update flowing through ingestion → extraction (mocked LLM) → item → summary.
- **Manual test** in a private test supergroup with topics before any real group.

---

## 8. Deployment checklist
- [ ] BotFather: create the bot, set name/description/commands, **disable privacy mode**
- [ ] Postgres provisioned; `prisma migrate deploy` runs on release
- [ ] Hosting with HTTPS; `setWebhook` with the secret token on startup
- [ ] `/health` endpoint (DB + job queue status)
- [ ] Sentry/error alerts to the owner
- [ ] Daily 19:00 WAT job verified and not double-sending (check `SummaryLog`)
- [ ] Groq quota monitoring + fallback tested by forcing 429s
- [ ] Privacy notice + `/privacy` text written
- [ ] Database backups enabled

---

## 9. Build milestones
1. **Skeleton:** TypeScript project, grammY bot with long polling locally, Prisma schema, `/start`, `/setup`, message ingestion from all topics.
2. **Extraction v1:** pre-filter + rule-based (chrono-node + keywords) items, so it works with no AI at all.
3. **AI extraction:** Groq provider, batching, redaction, Zod validation, update/merge logic, fallback chain.
4. **Daily summary:** the 19:00 job, formatting, topic posting, links, splitting, lifecycle rules.
5. **Commands:** `/catchup`, `/items`, `/due`, `/remove`, `/settings`, `/editors`, `/privacy`.
6. **Production:** webhook mode, deploy, monitoring, retention cleanup job, eval script.
7. **Pilot** with one or two real class groups → fix errors from the eval set → open up.

---

## 10. Out of scope for v1
- WhatsApp (no group bot API)
- Reading images/voice notes (OCR/transcription) — later
- A web dashboard — later
- Reminders before deadlines (separate from the daily summary) — later, if Ysabel wants them

---

## 11. Open decisions (confirm with Ysabel)
1. ~~**Where the summary goes**~~ — decided: group + DM opt-in (§4.5).
2. **Which topic** the group summary is posted in: chosen at `/setup` (default), falling back to General.
3. **Notes & tips:** shown once on the day posted (default), or kept for 7 days like undated assignments?
4. ~~**Who can correct due dates**~~ — decided: admins + trusted editors (§4.6).
5. **Send a summary on days with nothing new?** Default: yes, a one-line "No academic updates today ✅".
