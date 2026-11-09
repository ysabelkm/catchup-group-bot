import { Bot, GrammyError, HttpError } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { commands } from "./handlers/commands.js";
import { ingest } from "./handlers/ingest.js";
import { membership } from "./handlers/membership.js";
import { admin } from "./handlers/admin.js";
import { corrections } from "./handlers/corrections.js";
import { personal } from "./handlers/personal.js";
import { sendDueSummaries } from "./summary/send.js";

/** Update types the bot asks Telegram for. */
export const ALLOWED_UPDATES = ["message", "edited_message", "my_chat_member", "callback_query"] as const;

const SUMMARY_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export function createBot(token = config.TELEGRAM_BOT_TOKEN) {
  const bot = new Bot(token);

  // Flood control: pace outgoing calls, and retry on 429 / 5xx (spec §5.1, §5.4).
  bot.api.config.use(apiThrottler());
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  // Idempotency: Telegram may deliver the same update more than once (spec §4.1).
  bot.use(async (ctx, next) => {
    const { count } = await prisma.processedUpdate.createMany({
      data: [{ updateId: BigInt(ctx.update.update_id) }],
      skipDuplicates: true,
    });
    if (count === 0) {
      logger.debug({ updateId: ctx.update.update_id }, "duplicate update skipped");
      return;
    }
    await next();
  });

  // "Send late, never skip" (spec §4.5): any activity after 7 PM checks that today's summaries
  // went out. Throttled; does nothing before SUMMARY_TIME or once everything is sent.
  let lastSummaryCheck = 0;
  bot.use(async (ctx, next) => {
    await next();
    if (Date.now() - lastSummaryCheck < SUMMARY_CHECK_INTERVAL_MS) return;
    lastSummaryCheck = Date.now();
    void sendDueSummaries(ctx.api).catch((err) => logger.error({ err }, "late summary check failed"));
  });

  bot.use(membership);
  bot.use(ingest);
  bot.use(personal);
  bot.use(corrections);
  bot.use(admin);
  bot.use(commands);

  // Never crash on a bad update; log it and move on (spec §4.2 step 7).
  bot.catch((err) => {
    const e = err.error;
    const updateId = err.ctx.update.update_id;
    if (e instanceof GrammyError) logger.error({ updateId, code: e.error_code, description: e.description }, "Telegram API error");
    else if (e instanceof HttpError) logger.error({ updateId, err: e.error }, "network error talking to Telegram");
    else logger.error({ updateId, err: e }, "unhandled error in update handler");
  });

  return bot;
}

/** Command menus shown in Telegram's UI. Only commands that are implemented. */
export async function registerCommands(bot: Bot) {
  await bot.api.setMyCommands(
    [
      { command: "catchup", description: "Everything since your last catch-up" },
      { command: "items", description: "All active items in your groups" },
      { command: "summary", description: "Today's summary so far" },
      { command: "settings", description: "Daily summary by DM on/off" },
      { command: "start", description: "What this bot does" },
      { command: "privacy", description: "What is stored and for how long" },
    ],
    { scope: { type: "all_private_chats" } },
  );
  await bot.api.setMyCommands(
    [
      { command: "summary", description: "Show today's summary so far" },
      { command: "items", description: "List assignments, tasks and notes still active" },
      { command: "due", description: "Admins/class reps: reply to set a due date" },
      { command: "remove", description: "Admins/class reps: reply to remove a wrong item" },
      { command: "settings", description: "Admins: summary on/off and options" },
      { command: "editors", description: "Admins: add or remove class reps" },
      { command: "setup", description: "Admins: turn on daily summaries here" },
      { command: "privacy", description: "What is stored and for how long" },
    ],
    { scope: { type: "all_group_chats" } },
  );
}
