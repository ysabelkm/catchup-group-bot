# Contributing to CatchUp

Thanks for helping. Every class group writes a little differently, so real examples make the biggest difference.

## Reporting a message the bot got wrong

Use the [missed message template](https://github.com/ysabelkm/catchup-group-bot/issues/new?template=missed_message.yml). Include:

- the message text, **with names, phone numbers and anything private removed**
- roughly when it was sent ("by Friday" means a different date depending on the day it was sent)
- what the bot should have done

## Setting up

Follow [Running it yourself → Run locally](README.md#2-run-locally). Then check everything passes:

```bash
npm run typecheck
npm test
```

The integration tests need a migrated Postgres at `DATABASE_URL`. Telegram is always faked, so you don't need a bot token to run the tests.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests:
   - **Extraction changes** (`src/extraction/`): add the real message that prompted the change as a case in `test/rules.test.ts` or `test/dates.test.ts`. Also add a case for a nearby message that should *not* change, so the rule doesn't over-reach.
   - **Schema changes**: edit `prisma/schema.prisma`, then run `npm run db:migrate -- --name <what_changed>` and commit the migration. CI fails if the schema and the migrations don't match.
   - **New environment variables**: add them to `src/config.ts`, `.env.example` and the README's configuration table.
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/):

   ```
   feat(commands): add /notes command to list recent notes
   fix(extraction): parse "next week Tuesday" as a date
   docs(readme): explain the keep-alive job
   ```

   Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `chore`. Scope is the area you changed (`bot`, `extraction`, `summary`, `commands`, `db`, `ci`…).
4. Open a pull request. CI runs typecheck, tests and build on Node 22 and 24.

## Guidelines

- Keep the bot quiet. Group chats are busy, so prefer replying to the person over posting to everyone, and rate-limit anything a member can trigger.
- Never log message text at `info` level or above, and never commit tokens or real student data, including in test fixtures and screenshots.
- Be kind in issues and reviews.
