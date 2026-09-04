# AGENTS.md

> Instructions for AI agents working on this codebase. Read this before making any changes.

## Commit Workflow

After **every** feature/fix iteration, the agent must:

1. Complete the code changes
2. Verify the build (run `npx tsc --noEmit` in the relevant package)
3. Stage and commit with a clear English commit message
4. Reply to the user with the commit message summary

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
