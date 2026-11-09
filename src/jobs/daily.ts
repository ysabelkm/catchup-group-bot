import { config } from "../config.js";
import { logger } from "../logger.js";
import { expireItems, processPending } from "../extraction/pipeline.js";

let running: Promise<DailyResult> | null = null;

export type DailyResult = {
  startedAt: string;
  status: "done" | "paused";
  processed: number;
  expired: number;
  notes: string[];
};

/**
 * Daily work, triggered by the external scheduler at SUMMARY_TIME (see /cron/daily):
 *   1. extract items from any messages still unprocessed
 *   2. expire items whose time has passed
 *   3. send summaries (milestone 4)
 * Overlapping triggers share one run.
 */
export function runDailyJobs(): Promise<DailyResult> {
  if (running) return running;
  running = (async (): Promise<DailyResult> => {
    const startedAt = new Date().toISOString();

    // Rule-based extraction uses no AI, so it runs even while paused.
    const processed = await processPending();
    const expired = await expireItems();

    if (config.BOT_PAUSED) {
      logger.warn({ processed, expired }, "summaries skipped: BOT_PAUSED is on");
      return { startedAt, status: "paused", processed, expired, notes: [] };
    }

    logger.info({ processed, expired }, "daily jobs done (summary sending arrives in milestone 4)");
    return { startedAt, status: "done", processed, expired, notes: ["summary not implemented yet"] };
  })().finally(() => {
    running = null;
  });
  return running;
}
