# AGENTS.md

> Instructions for AI agents working on this codebase. Read this before making any changes.

---

## 🔴 Core Principle: AUTH_ENABLED Mode

**This is the highest-level design principle. All changes must follow this rule.**

When `AUTH_ENABLED=false`:
- The app is a **standalone single-user** version for LAN use
- **No login**, **no permission checks**, **no data isolation**
- All routes and data are fully accessible
- The UI should not show any auth-related UI (login links, user badges, role filters)

When `AUTH_ENABLED=true`:
- **Data is fully isolated** between users
- Each user can only see their own data (assignments, annotations, mistakes)
- Role-based access control applies:
  - `admin`: full access to everything (user management, system settings, all data)
  - `teacher`: can view books/annotations/mistakes/assignments + grade assignments; cannot manage users or system settings
  - `student`: can only see and manage their own data
- Frontend AND backend must both enforce role checks — never rely on frontend alone

---

## Commit Workflow

### When to commit

| User says... | Action |
|---|---|
| Nothing (default, no mention of commit/push) | **Do NOT commit**. Keep changes in working area. Accumulate change descriptions. |
| "提交" / "commit" / "git commit" | **Commit** all accumulated changes since last commit with English message, then reply with summary |
| "commit and push" / "提交并推送" / "push" | **Commit then push** all accumulated changes, then reply with summary |
| "别提交" / "不提交" / "don't commit" / "先别提交" | Do NOT commit, only reply with change summary |
| "用中文" / "中文 commit" | Reply with Chinese commit message instead |

### Accumulating changes across non-commit turns

When the user does not ask to commit in multiple consecutive turns, the agent must
**accumulate** the change descriptions from each turn (do not lose them). When the user
finally asks to commit or push, produce a **single consolidated commit** that summarizes
all the accumulated changes together, rather than committing them one-by-one or discarding
earlier summaries.

### Pre-commit hook (husky)

- `.husky/pre-commit` runs `npm run build` before every commit
- This compiles both server (tsc) and client (vite build)
- If build fails, the commit is blocked — fix errors and retry
- If Prisma schema was modified: run `cd server && npx prisma db push` before committing
- If new npm packages were used: ensure they are installed and in package.json
- To bypass in emergencies only: `git commit --no-verify` (NOT recommended)

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

---

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

---

## Coding Conventions

### General

- **Storage paths** are relative (`/storage/books/...`); the server serves them statically
- **Multi-DPI** books store pages under `books/{id}/{dpi}/page-XXXX.png`
- **File operations** in deletion routes must be wrapped in individual `try/catch` — missing files must never block DB deletion
- **Book covers** use the `<BookCover>` component with fade-in placeholder — never raw `<img>` tags
- **Home page is browse-only** — no edit/delete actions for end users
- **Feature parity first, UI polish second** — when refactoring UI, never change existing functionality
- **Do NOT start dev servers** — never run `npm run dev` (or any long-running dev script) in `client/` or `server/`. The user manages dev servers themselves. Only run short-lived commands like `npx tsc --noEmit`, `npm run build`, or one-off scripts.

### UI / UX Conventions

- **ConfirmDialog over window.confirm** — always use the unified `ConfirmDialog` component (`useConfirm` hook) for confirmation dialogs. Never use `window.confirm`. Different actions should use different colored confirm buttons (red for delete, blue for submit, green for approve, amber for return).
- **Toast notifications with sonner** — always use `toast.success()` / `toast.error()` from `sonner` for user feedback on async operations (save, delete, submit, etc.). Never use `alert()`.
- **Button disabled states** — action buttons (undo/redo, save, delete, submit) must have proper `disabled` states when the action is not available (e.g., nothing to undo, save in progress, status prevents deletion).
- **Save failure blocks navigation** — when saving fails in a page context (e.g., assignment mode), block page navigation and exit until save succeeds or user acknowledges. Show a clear error toast.
- **Loading states** — async operations that take time should show a loading indicator and disable related buttons.

### Role & Permission Conventions

- **Frontend + backend protection** — role-based access must be enforced on BOTH sides. Frontend hides UI elements and guards routes; backend middleware blocks unauthorized requests.
- **Admin sidebar menu filtering** — the admin sidebar must filter menu items by user role. Teachers should not see admin-only menu items (user management, auth settings, storage settings, scan import).
- **Role badge in admin header** — when AUTH_ENABLED=true, show the user's role badge in the admin top bar: `(管理员)` for admin, `(教师)` for teacher.
- **Admin self-delete protection** — admin users cannot delete their own account via the user management API.
- **Teacher can view but not modify books** — teachers can list/view books in the admin panel but cannot create, edit, or delete them (and cannot import PDFs).

### React Conventions

- **Effect dependencies** — all `useEffect` hooks must have complete dependency arrays. Use ESLint react-hooks/exhaustive-deps as a guide.
- **Stable props for child components** — callbacks and data passed to child components from parents should be wrapped in `useCallback` / `useMemo` to prevent unnecessary re-renders, especially for complex child components.
- **ConfirmDialog Provider** — wrap the app in `<ConfirmProvider>` once at the root (in App.tsx), then use `useConfirm()` hook in components.

---

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

### Auth Middleware Convention

Three middleware levels exist in `server/src/middleware/auth.ts`:

| Middleware | AUTH_ENABLED=false | AUTH_ENABLED=true |
|---|---|---|
| `authRequired` | Pass through | Requires valid token |
| `teacherOrAdminRequired` | Pass through | Requires valid token + role is teacher or admin |
| `adminRequired` | Pass through | Requires valid token + isAdmin=true |

Use the appropriate middleware for each route based on the minimum access level needed.
For routes where some methods need higher access, apply the base middleware via `router.use()` and add stricter middleware to individual routes.
