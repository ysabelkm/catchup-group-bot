import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { ALLOWED_UPDATES, createBot, registerCommands } from "./bot.js";
import { createHttpServer, WEBHOOK_PATH } from "./server.js";

async function main() {
  const bot = createBot();
  await bot.init();
  logger.info({ username: bot.botInfo.username }, "bot initialised");

  if (!bot.botInfo.can_read_all_group_messages) {
    logger.warn(
      "Privacy mode is ON: the bot only sees commands and replies in groups where it isn't admin. " +
        "Disable it in BotFather → /setprivacy (spec §5.4).",
    );
  }
  if (config.BOT_PAUSED) logger.warn("BOT_PAUSED=true: AI calls and summaries are paused.");

  await registerCommands(bot);

  if (config.BOT_MODE === "webhook") {
    const server = createHttpServer(bot);
    await new Promise<void>((resolve) => server.listen(config.PORT, resolve));
    logger.info({ port: config.PORT }, "http server listening");

    const webhookUrl = new URL(WEBHOOK_PATH, config.PUBLIC_BASE_URL).toString();
    await bot.api.setWebhook(webhookUrl, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    logger.info({ webhookUrl }, "webhook registered");

    const shutdown = (signal: string) => {
      logger.info({ signal }, "shutting down");
      server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
      // Don't hang forever on open connections.
      setTimeout(() => process.exit(0), 10_000).unref();
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    return;
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  // Polling and webhooks can't both be active; bot.start() removes any webhook first.
  // Running locally while deployed would steal updates from the server.
  logger.warn("Polling mode: stop the deployed bot first, or it will stop receiving updates.");
  await bot.start({
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: () => logger.info("long polling started"),
  });
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
