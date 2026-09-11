# AGENTS.md

> Instructions for AI agents working on this codebase. Read this before making any changes.

## Commit & Reply Workflow

After **every** feature/fix iteration, the agent must:

1. Complete the code changes
2. **Auto-commit by default** — always run `git commit` after changes. The husky pre-commit hook will automatically run `npm run build` (server + client) and block the commit if there are build errors. The ONLY exception is when the user's message explicitly says "don't commit" / "不提交" / "先别提交" / "别提交". If the user says nothing about committing, you MUST commit.
3. Reply to the user with an **English commit message** (formatted as a code block or plain text) summarizing the changes

### Pre-commit hook (husky)

- `.husky/pre-commit` runs `npm run build` before every commit
- This compiles both server (tsc) and client (vite build)
- If build fails, the commit is blocked — fix errors and retry
- If Prisma schema was modified: run `cd server && npx prisma db push` before committing
- If new npm packages were used: ensure they are installed and in package.json
- To bypass in emergencies only: `git commit --no-verify` (NOT recommended)

### When to actually commit

| User says... | Action |
|---|---|
| Nothing (default) | **Auto-commit** with English message, then reply |
| "提交" / "commit" / "push" / "git commit" | Commit with English message, then reply |
| "用中文" / "中文 commit" | Reply with Chinese commit message instead |
| "别提交" / "不提交" / "don't commit" / "先别提交" | Do NOT commit, only reply with commit message |

### Accumulating commits across "don't commit" turns

When the user says "don't commit" in multiple consecutive turns, the agent must
**accumulate** the commit messages from each turn (do not lose them). When the user
finally asks to commit (or the default auto-commit resumes), produce a **single
consolidated commit** that summarizes all the accumulated changes together, rather
than committing them one-by-one or discarding earlier summaries.

### Commit Message Format

Use conventional commits with English messages:

```
type(scope): short summary in imperative mood

Optional longer body explaining what and why,
broken into bullet points or paragraphs.
```

**Types:** `feat` | `fix` | `refactor` | `chore` | `docs` | `style`

**Scopes:** `client` | `server` | `shared` | `*`

### Example

```
feat(client): add batch select/delete to admin books table

- Checkbox column with select-all (indeterminate state)
- Batch delete selected books via DELETE /admin/books/batch
- Progress modal with per-book tracking
```

### Desensitization Rule (Username / Path Privacy)

Never commit your local OS username in any file — code, comments, scripts, docs, or config. Always use the placeholder `{user}` instead.

| Context | Rule |
|---|---|
| Docs / README / comments | Use `/Users/{user}/...` for path examples |
| Scripts / config (default values) | Use `/Users/{user}/...` or read from `$HOME` / env var |
| Code (runtime paths) | Use `os.homedir()` or env var — never hardcode a username |

Before committing, verify with: `grep -rn "$(whoami)" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.md" --include="*.sh" --include="*.env" . | grep -v node_modules | grep -v '.git/'`

If any hit is found, replace with `{user}` (or appropriate env-based alternative) before committing.

## Project Structure

```
edu-workspace/
├── client/          # React + Vite + Tailwind frontend
│   └── src/
│       ├── pages/      # Route pages (Home, BookViewer, AdminPanel)
│       ├── components/ # Reusable components (BookCover, admin/*)
│       ├── api/        # Axios client and API helpers
│       └── store/      # Zustand state management
└── server/          # Express + Prisma backend
    └── src/
        ├── routes/     # REST API route handlers
        └── services/   # Business logic (pdfProcessor, etc.)
```

## Key Conventions

- **Storage paths** are relative (`/storage/books/...`); the server serves them statically
- **Multi-DPI** books store pages under `books/{id}/{dpi}/page-XXXX.png`
- **File operations** in deletion routes must be wrapped in individual `try/catch` — missing files must never block DB deletion
- **Book covers** use the `<BookCover>` component with fade-in placeholder — never raw `<img>` tags
- **Home page is browse-only** — no edit/delete actions for end users
- **Feature parity first, UI polish second** — when refactoring UI, never change existing functionality
- **Do NOT start dev servers** — never run `npm run dev` (or any long-running dev script) in `client/` or `server/`. The user manages dev servers themselves. Only run short-lived commands like `npx tsc --noEmit`, `npm run build`, or one-off scripts.

## API Response Convention

All API responses must follow a consistent format:

### Success responses

Return the resource object or array directly, or a paginated envelope:

```jsonc
// Single resource
{ "assignment": { ... } }

// List (paginated)
{ "data": [...], "total": 100, "page": 1, "pageSize": 20 }

// Delete / action
{ "success": true }
```

### Error responses

Always use `{ "error": "message" }` with an appropriate HTTP status code:

```jsonc
// 400 Bad Request
{ "error": "bookId required" }

// 403 Forbidden
{ "error": "no permission to modify this assignment" }

// 404 Not Found
{ "error": "not found" }
```

### Rules

- **Never** mix `success: false` into success responses — only use `success: true` for delete/action confirmations
- **All async route handlers** must be wrapped in `asyncHandler()` so unhandled errors reach the global error middleware (Express 4 does not catch async errors automatically)
- **Global error middleware** returns `{ success: false, error, code }` with Prisma code mapping (P2002→409, P2025→404)
- **Frontend** response interceptor normalizes `error.message` from server's `{ error }` field so all `.catch()` blocks get a human-readable message
- **Do not** invent new response shapes — follow the patterns above
