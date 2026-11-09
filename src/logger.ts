import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  // Never log bot tokens or API keys if a config object is logged by mistake.
  redact: ["*.TELEGRAM_BOT_TOKEN", "*.GROQ_API_KEY", "*.GEMINI_API_KEY", "*.DATABASE_URL"],
  ...(config.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
    : {}),
});
