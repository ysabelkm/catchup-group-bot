# CLAUDE.md

Instructions for Claude (and other AI coding assistants) working in this repo.

## Commits and pushing

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit:

```
<type>(<scope>): <short summary>
```

- **type**, one of:
  - `feat`: a new feature
  - `fix`: a bug fix
  - `docs`: documentation only
  - `test`: adding or fixing tests
  - `refactor`: a code change that neither fixes a bug nor adds a feature
  - `perf`: a performance improvement
  - `ci`: GitHub Actions and other CI config
  - `build`: the build, dependencies or deploy config (`package.json`, `render.yaml`)
  - `chore`: anything else that doesn't touch `src/` or `test/`
- **scope**: the area changed, e.g. `bot`, `extraction`, `summary`, `commands`, `db`, `server`, `ci`, `deps`, `readme`. Use the narrowest scope that fits. Leave it out only if the change really spans everything.
- **summary**: lower case, imperative mood ("add", not "added"/"adds"), no full stop at the end, 72 characters or fewer.
- Add a body, separated by a blank line, when the *why* isn't obvious. Use `-` bullets for several changes.
- Breaking changes: put `!` after the scope (`feat(db)!: ...`) and add a `BREAKING CHANGE:` line to the body.

Examples:

```
feat(commands): add /notes command to list recent notes
fix(extraction): stop treating multi-line instructions ending in "?" as questions
fix(ci): run prisma migrate deploy before the tests
docs(readme): add self-hosting guide
test(extraction): cover course-code-only PDF titles
```

One logical change per commit. Don't mix a feature with unrelated cleanups.

Before pushing:

1. `npm run typecheck` and `npm test` pass.
2. No secrets in the diff: `.env` is never committed and tokens are never printed or pasted.
3. Push to `main` only when asked. Pushing to `main` deploys to production (Render auto-deploys the live bot).
