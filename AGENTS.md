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
