import { config } from "../config.js";
import { logger } from "../logger.js";

let running: Promise<DailyResult> | null = null;

export type DailyResult = { startedAt: string; status: "done" | "paused" | "skipped"; notes: string[] };

/**
 * Daily work, triggered by the external scheduler at SUMMARY_TIME (see /cron/daily).
 * Milestones 2–4 fill this in: process pending messages → expire items → send summaries.
 * Overlapping triggers share one run.
 */
export function runDailyJobs(): Promise<DailyResult> {
  if (running) return running;
  running = (async (): Promise<DailyResult> => {
    const startedAt = new Date().toISOString();
    if (config.BOT_PAUSED) {
      logger.warn("daily jobs skipped: BOT_PAUSED is on");
      return { startedAt, status: "paused", notes: [] };
    }
    logger.info("daily jobs triggered (summary not implemented yet: milestone 4)");
    return { startedAt, status: "skipped", notes: ["summary not implemented yet"] };
  })().finally(() => {
    running = null;
  });
  return running;
}
