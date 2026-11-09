import type { Api } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { expireItems, processPending } from "../extraction/pipeline.js";
import { sendDueSummaries, type SendReport } from "../summary/send.js";

let running: Promise<DailyResult> | null = null;

export type DailyResult = {
  startedAt: string;
  status: "done" | "paused";
  processed: number;
  expired: number;
  summaries: SendReport | null;
};

/**
 * Daily work, triggered by the external scheduler at SUMMARY_TIME (see /cron/daily):
 *   1. extract items from any messages still unprocessed
 *   2. expire items whose time has passed
 *   3. send today's summaries (spec §4.5)
 * Overlapping triggers share one run.
 */
export function runDailyJobs(api: Api): Promise<DailyResult> {
  if (running) return running;
  running = (async (): Promise<DailyResult> => {
    const startedAt = new Date().toISOString();

    // Rule-based extraction uses no AI, so it runs even while paused.
    const processed = await processPending();
    const expired = await expireItems();

    if (config.BOT_PAUSED) {
      logger.warn({ processed, expired }, "summaries skipped: BOT_PAUSED is on");
      return { startedAt, status: "paused", processed, expired, summaries: null };
    }

    const summaries = await sendDueSummaries(api);
    logger.info({ processed, expired, summaries }, "daily jobs done");
    return { startedAt, status: "done", processed, expired, summaries };
  })().finally(() => {
    running = null;
  });
  return running;
}
