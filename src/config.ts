import "dotenv/config";
import { createHash } from "node:crypto";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const bool = z.preprocess(
  emptyToUndefined,
  z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
);
const posInt = (def: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(def));

const EnvSchema = z
  .object({
    NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "production", "test"]).default("development")),
    LOG_LEVEL: z.preprocess(emptyToUndefined, z.string().default("info")),

    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    /** Any string; it's hashed into Telegram's allowed format (see webhookSecretToken). */
    TELEGRAM_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(16, "use at least 16 characters").optional()),
    /** Public HTTPS URL of the deployed app. Falls back to Render's RENDER_EXTERNAL_URL. */
    PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    BOT_MODE: z.preprocess(emptyToUndefined, z.enum(["polling", "webhook"]).default("polling")),
    PORT: posInt(3000),
    /** Protects the /cron/* endpoints that the external scheduler calls. */
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(16, "use at least 16 characters").optional()),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["groq", "gemini"]).default("groq")),
    GROQ_API_KEY: optionalString,
    GROQ_MODEL_PRIMARY: z.preprocess(emptyToUndefined, z.string().default("llama-3.3-70b-versatile")),
    GROQ_MODEL_FALLBACK: z.preprocess(emptyToUndefined, z.string().default("llama-3.1-8b-instant")),
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: optionalString,

    SUMMARY_TIME: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "SUMMARY_TIME must be HH:MM")
        .default("19:00"),
    ),
    DEFAULT_TIMEZONE: z.preprocess(emptyToUndefined, z.string().default("Africa/Lagos")),
    NO_DUE_DATE_DAYS: posInt(7),
    RAW_MESSAGE_RETENTION_DAYS: posInt(30),
    EXTRACTION_BATCH_SIZE: posInt(20),

    SENTRY_DSN: optionalString,
    BOT_OWNER_TELEGRAM_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
    BOT_PAUSED: bool,
  })
  .superRefine((env, ctx) => {
    if (env.BOT_MODE === "webhook") {
      if (!env.TELEGRAM_WEBHOOK_SECRET)
        ctx.addIssue({ code: "custom", path: ["TELEGRAM_WEBHOOK_SECRET"], message: "required in webhook mode" });
      if (!env.PUBLIC_BASE_URL)
        ctx.addIssue({ code: "custom", path: ["PUBLIC_BASE_URL"], message: "required in webhook mode" });
      if (!env.CRON_SECRET)
        ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "required in webhook mode" });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

function loadConfig(): Config {
  const env = {
    ...process.env,
    // Render sets RENDER_EXTERNAL_URL automatically; use it unless overridden.
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL,
  };
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Logger depends on config, so print directly.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();

/**
 * Telegram's secret_token only allows A-Z, a-z, 0-9, _ and -, but generated secrets
 * (e.g. Render's generateValue) may contain + / =. Hashing gives a stable, valid token.
 */
export const webhookSecretToken = config.TELEGRAM_WEBHOOK_SECRET
  ? createHash("sha256").update(config.TELEGRAM_WEBHOOK_SECRET).digest("hex")
  : undefined;
