import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { webhookCallback, type Bot } from "grammy";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { runDailyJobs } from "./jobs/daily.js";

export const WEBHOOK_PATH = "/telegram/webhook";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Accepts `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>`. */
function cronAuthorised(req: IncomingMessage, url: URL) {
  const secret = config.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const key = header ?? url.searchParams.get("key") ?? "";
  return safeEqual(key, secret);
}

/**
 * HTTP server for production (spec §5.4, §8):
 *   POST /telegram/webhook  Telegram updates; rejects requests without the secret token header
 *   GET  /health            DB status
 *   POST /cron/daily        7 PM trigger from the external scheduler (also wakes a sleeping free instance)
 */
export function createHttpServer(bot: Bot) {
  // grammY checks X-Telegram-Bot-Api-Secret-Token and answers 401 when it doesn't match.
  const handleUpdate = webhookCallback(bot, "http", {
    secretToken: config.TELEGRAM_WEBHOOK_SECRET,
    // Answer Telegram before its own timeout; a slow update is logged rather than retried forever.
    onTimeout: "return",
    timeoutMilliseconds: 25_000,
  });

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === WEBHOOK_PATH && req.method === "POST") {
        await handleUpdate(req, res);
        return;
      }

      if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
        try {
          await prisma.$queryRaw`SELECT 1`;
          send(res, 200, { ok: true, db: "ok", paused: config.BOT_PAUSED });
        } catch (err) {
          logger.error({ err }, "health check: database unreachable");
          send(res, 503, { ok: false, db: "error" });
        }
        return;
      }

      if (url.pathname === "/cron/daily" && (req.method === "POST" || req.method === "GET")) {
        if (!cronAuthorised(req, url)) {
          send(res, 401, { ok: false });
          return;
        }
        // Reply at once so the scheduler doesn't time out; the work continues in the background.
        void runDailyJobs().catch((err) => logger.error({ err }, "daily jobs failed"));
        send(res, 202, { ok: true, started: true });
        return;
      }

      if (url.pathname === "/" && req.method === "GET") {
        send(res, 200, { name: "CatchUp", ok: true });
        return;
      }

      send(res, 404, { ok: false });
    } catch (err) {
      logger.error({ err, path: url.pathname }, "http handler error");
      if (!res.headersSent) send(res, 500, { ok: false });
    }
  });
}
