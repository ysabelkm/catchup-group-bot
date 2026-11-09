import { config } from "../config.js";

/**
 * User-facing copy. All HTML-formatted (parse_mode: "HTML").
 * Kept in one place so the privacy wording stays consistent (spec §6).
 */

export const WELCOME = `👋 <b>Hi, I'm CatchUp.</b>

I sit in your class group, read the messages in every topic, and pick out the academic content: <b>assignments, tasks, projects, notes and tips</b>.

Every evening at <b>${config.SUMMARY_TIME} (Lagos time)</b> I post one clean summary in the group, so you can see what's due without scrolling through hundreds of messages.

<b>To add me to a group:</b>
1. Add me to the group.
2. An admin sends /setup in the topic where summaries should be posted.

<b>Here in private:</b>
• /catchup: everything since you last checked, across your groups
• /items: everything still active
• Tap the button below to also get the 7 PM summary here.

Send /privacy to see what I store and for how long.`;

export const PRIVACY = `🔒 <b>What CatchUp stores</b>

<b>What I read:</b> text and captions of messages in groups I'm added to, from every topic, plus file names and links. I don't download files, photos or voice notes.

<b>Why:</b> to find assignments, tasks, projects, notes and tips, and list them in a daily summary.

<b>What I keep:</b>
• Raw message text: deleted after <b>${config.RAW_MESSAGE_RETENTION_DAYS} days</b>.
• Extracted items (title, short summary, due date, link to the message): kept while the group uses the bot.
• Your Telegram user id and first name, so admins can manage class reps and so /catchup only shows groups you're in.

<b>AI processing:</b> messages may be sent to an AI provider to find academic content. Before that, I remove phone numbers, emails and names, and never send Telegram ids.

<b>How to remove it:</b> a group admin can remove the bot from the group at any time. For full deletion of a group's data, contact the bot owner.`;

export const JOIN_NOTICE = `👋 <b>Hi everyone, I'm CatchUp.</b>

From now on I'll read messages in this group (all topics) to pick out <b>assignments, tasks, projects, notes and tips</b>, and post a daily summary at <b>${config.SUMMARY_TIME} Lagos time</b>.

Raw messages are deleted after ${config.RAW_MESSAGE_RETENTION_DAYS} days. Send /privacy for details. An admin can remove me at any time.

<b>Admins:</b> send /setup in the topic where you'd like the daily summary posted.`;

export const PRIVACY_MODE_WARNING = `⚠️ <b>I can't see normal messages in this group yet.</b>

Telegram hides group messages from bots unless one of these is true:
• The bot owner turns off privacy mode (BotFather → /setprivacy → Disable), then removes and re-adds me, <b>or</b>
• You make me an <b>admin</b> of this group (no special permissions needed).

Until then I'll only see commands, so the summaries will be empty.`;
