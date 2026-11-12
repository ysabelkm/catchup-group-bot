/**
 * Safe defaults so the suite runs anywhere (CI, a fresh clone) without a .env file.
 * Telegram is always faked in tests; the token is never used to reach Telegram.
 * A local .env is read first, so its DATABASE_URL wins over the default.
 */
import "dotenv/config";

process.env.TELEGRAM_BOT_TOKEN ||= "123456:test-token";
process.env.DATABASE_URL ||= "postgresql://localhost:5432/catchup_bot";
process.env.BOT_MODE ||= "polling";
process.env.LOG_LEVEL ||= "silent";
