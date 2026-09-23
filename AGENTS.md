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

### Trigger rules based on conversation markers

The agent inspects the **first line** (opening marker) and **last line** (closing marker) of the user's message for a bare digit `1` or `2`. These markers control the commit/push behavior for the entire current conversation turn:

| Opening / Closing marker | Behavior this turn |
|---|---|
| **Neither** `1` nor `2` at start or end | **Do NOT commit**. Only return the proposed commit message in the reply so the user can review it — do NOT execute any `git` command. |
| `1` at the **start** of user's message | **Immediately commit** the current working tree (all accumulated changes since last commit), then reply with summary. |
| `1` at the **end** of user's message | After finishing all requested work in this turn, **commit** the resulting working tree, then reply with summary. |
| `2` at the **start** of user's message | **Immediately commit and push** the current working tree, then reply with summary. |
| `2` at the **end** of user's message | After finishing all requested work in this turn, **commit and push** the resulting working tree, then reply with summary. |

**Priority notes:**
- If the user message contains both an opening and a closing marker, the **opening marker** wins — it means "commit/push now, then handle the rest of the request normally".
- `1`/`2` markers are matched only as **standalone digits** (e.g. `任务做完了 1` at the end counts; `v1.2.1` does not).
- When no marker is present, the agent still **accumulates** change descriptions and prepares a well-formed commit message — it just stops short of running `git commit`.

### Legacy explicit keywords (still supported)

For backwards compatibility, the following explicit phrases still work anywhere in the message, but the digit markers above take precedence if both appear:

| User says... | Action |
|---|---|
| "提交" / "commit" / "git commit" | **Commit** all accumulated changes since last commit with English message, then reply with summary |
| "commit and push" / "提交并推送" / "push" | **Commit then push** all accumulated changes, then reply with summary |
| "别提交" / "不提交" / "don't commit" / "先别提交" | Do NOT commit, only reply with change summary |
| "用中文" / "中文 commit" | Reply with Chinese commit message instead |

### Accumulating changes across non-commit turns

When the user does not ask to commit (either via digit marker or explicit keyword) in multiple consecutive turns, the agent must
**accumulate** the change descriptions from each turn (do not lose them). When the user
finally uses a `1`/`2` marker or says "commit" / "push", produce a **single consolidated commit** that summarizes
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
- **Markdown files location** — all agent-authored markdown docs (plans, specs, design notes, checklists, etc.) MUST be created under the root-level `markdown/` folder (`edu-workspace/markdown/`). Never scatter `.md` files across the repo or place them in `.trae/documents/`. Create the `markdown/` folder if it does not exist.

### UI / UX Conventions

- **ConfirmDialog over window.confirm** — always use the unified `ConfirmDialog` component (`useConfirm` hook) for confirmation dialogs. Never use `window.confirm`. Different actions should use different colored confirm buttons (red for delete, blue for submit, green for approve, amber for return).
- **Toast notifications with sonner** — always use `toast.success()` / `toast.error()` from `sonner` for user feedback on async operations (save, delete, submit, etc.). Never use `alert()`.
- **Button disabled states** — action buttons (undo/redo, save, delete, submit) must have proper `disabled` states when the action is not available (e.g., nothing to undo, save in progress, status prevents deletion).
- **Save failure blocks navigation** — when saving fails in a page context (e.g., assignment mode), block page navigation and exit until save succeeds or user acknowledges. Show a clear error toast.
- **Loading states** — async operations that take time should show a loading indicator and disable related buttons.

### Role & Permission Conventions

### shadcn/ui Patterns

This project uses shadcn/ui components throughout. All UI work must follow these patterns:

#### Color Tokens (never hardcode hex or `gray-*`/`white`/`black`)

| Instead | Use | Reason |
|---|---|---|
| `bg-white` | `bg-background` / `bg-card` | Dark mode auto-adapts |
| `bg-gray-50` | `bg-muted` | |
| `text-gray-700` / `text-gray-800` | `text-foreground` | |
| `text-gray-500` / `text-gray-400` | `text-muted-foreground` | |
| `border-gray-300` / `border-gray-200` | `border-border` | |
| `divide-gray-100` | `divide-border` | Table tbody separators |
| `hover:bg-gray-100` | `hover:bg-accent` | |
| `bg-gray-100 hover:bg-gray-200` | `bg-muted hover:bg-muted/80` | |
| `bg-black/40` / `bg-black/50` | `bg-black/40` (mask only) | Masks are OK, they're intentionally dark overlays |
| `text-white` on `bg-primary` | `text-primary-foreground` | Auto-inverts when primary color changes |
| `text-white` on `bg-destructive` | `text-destructive-foreground` | Same |
| `text-white` on `bg-amber-600` | Keep `text-white` | Custom brand colors keep their own text color |
| Raw hex `#fff`, `#000` | Never use | |

#### Semantic Color Tags (book status, assignment grade, etc.)

Light mode: `bg-{color}-50` or `bg-{color}-100` + `text-{color}-600` or `text-{color}-700`
Dark mode: `bg-{color}-950/50` or `bg-{color}-950/60` + `text-{color}-400` + `border-{color}-800`

Example for amber/warning tag:
```tsx
className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400"
```

#### Native `<input>` / `<select>` / `<textarea>` Must Have Background + Text Color

Native form elements only declare `border border-input` but default to browser `bg-white color:black`. In dark mode, transparent backgrounds become dark + browser black text = invisible. Always add all three:

```tsx
// ❌ Wrong — invisible in dark mode
<input className="border border-input rounded-md px-3 py-2" />

// ✅ Right
<input className="border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-md px-3 py-2" />
```

#### Button: Prefer shadcn `<Button>`, Not Native `<button>`

Native `<button>` with hardcoded class strings is fragile. Use shadcn Button variants:

```tsx
import { Button } from "@/components/ui/button";

<Button variant="default">主操作</Button>        // bg-primary text-primary-foreground
<Button variant="outline">次要操作</Button>       // border border-input bg-background
<Button variant="secondary">第三级</Button>       // bg-secondary text-secondary-foreground
<Button variant="destructive">删除</Button>       // bg-destructive text-destructive-foreground
<Button variant="ghost">图标按钮</Button>         // transparent, hover:bg-accent
<Button variant="link">链接文字</Button>          // underline-offset-4 hover:underline
<Button size="sm">小按钮</Button>                 // h-8 text-xs
<Button size="lg">大按钮</Button>                 // h-10
<Button size="icon">图标方形</Button>             // h-9 w-9
```

**When NOT to convert** (safe to leave as native):
- Self-closing `<button ... />` tags (regex can't handle these blindly)
- Buttons with dynamic className like `className={someCondition ? 'px-3' : 'px-4'}`
- Buttons inside custom complex layouts (e.g., drag-drop zones)

#### Confirmation Dialog: Use shadcn `<AlertDialog>` + `useConfirm()`

The project wraps AlertDialog in `ConfirmDialog.tsx` exposing `useConfirm()` returning `Promise<boolean>`:

```tsx
const confirm = useConfirm();
const ok = await confirm({ title: '删除书籍', message: '此操作不可撤销', confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90' });
if (ok) await deleteBook();
```

Confirm button color conventions:
- **Red** (`bg-destructive` + `text-destructive-foreground`) — delete, destroy
- **Amber** (`bg-amber-600` + `text-white`) — return to student, soft-delete
- **Green** (`bg-green-600` + `text-white`) — approve, submit
- **Blue (default)** — save, confirm normal action

#### Modal Dialog: Use shadcn `<Dialog>`

For modals with title + description + footer:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

<Dialog open={show} onOpenChange={setShow}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>标题</DialogTitle>
      <DialogDescription>描述</DialogDescription>
    </DialogHeader>
    {/* content */}
    <DialogFooter>
      <Button variant="outline" onClick={() => setShow(false)}>取消</Button>
      <Button onClick={handleOk}>确定</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**When to keep native fixed-inset overlay instead of Dialog**:
- Non-dismissible progress loaders (deleteProgress, scanProgress) — should NOT be closable by ESC or overlay click
- Max-w-4xl complex editors (TOC drag-drop, pairing rules) — too risky to convert

#### Admin Layout: shadcn `<Sidebar>` + `<SidebarInset>`

The admin uses a **two-level** structure: primary tabs in the header, secondary menu in the sidebar.

```tsx
import { Sidebar, SidebarContent, SidebarHeader, SidebarProvider, SidebarInset, SidebarTrigger, SidebarRail, SidebarMenu, SidebarMenuButton } from "@/components/ui/sidebar";
import { NavLink } from "react-router-dom";

<SidebarProvider defaultOpen>
  <Sidebar variant="inset" collapsible="icon">
    <SidebarHeader>{/* logo only */}</SidebarHeader>
    <SidebarContent>
      <SidebarMenu>
        {items.map(item => (
          <SidebarMenuButton asChild tooltip={item.label} key={item.path}>
            <NavLink to={item.path}>{/* NavLink children */}</NavLink>
          </SidebarMenuButton>
        ))}
      </SidebarMenu>
    </SidebarContent>
    <SidebarRail />
  </Sidebar>
  <SidebarInset>
    <header className="h-14 bg-sidebar border-b border-sidebar-border">
      <SidebarTrigger />
      {/* Primary tabs */}
      {/* User info + logout */}
    </header>
    <Outlet />
  </SidebarInset>
</SidebarProvider>
```

Key points:
- `SidebarMenuButton asChild` + `tooltip={item.label}` enables:
  - Tooltip on hover in collapsed state (free from TooltipProvider inside Sidebar)
  - No nested `<a><button></button></a>` — NavLink becomes the root element via Radix Slot
- `variant="inset"` — SidebarInset follows sidebar width changes (required for correct collapsible behavior)
- `collapsible="icon"` — collapses to 3rem (48px) icon-only width with Cmd+B shortcut
- `group-data-[collapsible=icon]:hidden` — hide Sidebar header text when collapsed

#### Table Containers

Wrap tables in shadcn Card-like containers:
```tsx
<div className="rounded-lg border border-border bg-card shadow-sm">
  <div className="p-4 border-b border-border">{/* header */}</div>
  <div className="overflow-x-auto">
    <table className="w-full text-sm">{/* rows */}</table>
  </div>
</div>
```

#### Duplicate Token Collapse

After many edits, className strings accumulate repeated Tailwind tokens like `dark:text-amber-400 dark:text-amber-400`. Use sed to collapse:

```bash
sed -i '' -e 's/dark:text-amber-400 dark:text-amber-400/dark:text-amber-400/g' *.tsx
```

**NEVER use perl/sed/python to auto-convert className patterns** — regex is greedy and destroys JS identifiers, imports, and component props. Manual or targeted sed only.

#### shadcn Install Notes

```bash
cd client && npx shadcn@latest add <component-name> -y -c client
```

After install, check what changed:
- `tailwind.config.js` — may add new `animate-*` tokens
- `src/styles/index.css` — may add new keyframes/variables for dark mode
- New files in `src/components/ui/` (dialog, sheet, tooltip, skeleton, sidebar, use-mobile hook, etc.)

### Role & Permission Conventions

- **Frontend + backend protection** — role-based access must be enforced on BOTH sides. Frontend hides UI elements and guards routes; backend middleware blocks unauthorized requests.
- **Admin sidebar menu filtering** — the admin sidebar must filter menu items by user role. Teachers should not see admin-only menu items (user management, auth settings, storage settings, scan import).
- **Role badge in admin header** — when AUTH_ENABLED=true, show the user's role badge in the admin top bar: `(管理员)` for admin, `(教师)` for teacher.
- **Admin self-delete protection** — admin users cannot delete their own account via the user management API.
- **Teacher can view but not modify books** — teachers can list/view books in the admin panel but cannot create, edit, or delete them (and cannot import PDFs).
- **Admin sees all data, teacher sees only own** — in admin list endpoints (annotations, mistakes, assignments), admin role returns all records; teacher role returns only records where `userId` matches the current user. Backend must filter by role, never rely on frontend.
- **Anonymous data (userId=null) is standalone-only** — records with `userId=null` were created in standalone mode (AUTH_ENABLED=false). When auth is enabled, these records should only be visible to admin (for migration purposes), not to regular users.
- **Cloud + local dual-write for syncable data** — features like reading progress that sync to the cloud should always write to localStorage first, then to the server if auth is enabled. On read, prefer server data when available, fall back to local. This ensures the app works in both modes without data loss.

### React Conventions

- **Effect dependencies** — all `useEffect` hooks must have complete dependency arrays. Use ESLint react-hooks/exhaustive-deps as a guide.
- **Stable props for child components** — callbacks and data passed to child components from parents should be wrapped in `useCallback` / `useMemo` to prevent unnecessary re-renders, especially for complex child components.
- **ConfirmDialog Provider** — wrap the app in `<ConfirmProvider>` once at the root (in App.tsx), then use `useConfirm()` hook in components.

---

## API Response Convention

All API responses must follow a consistent format. The goal is one shape for every endpoint so the frontend never has to guess.

### Success responses

**Single resource** — always wrap in `data`:

```jsonc
{ "data": { "id": 1, "title": "..." } }
```

**List (paginated)** — always `data` + `total` + `page` + `pageSize`:

```jsonc
{ "data": [...], "total": 100, "page": 1, "pageSize": 20 }
```

**List (non-paginated / simple array)** — still wrap in `data`:

```jsonc
{ "data": [...] }
```

**Delete / action / write confirmation** — use `success: true`:

```jsonc
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
- **Single resource endpoints always return `{ data: resource }`** — never return the resource bare, and never use a key named after the resource (e.g. no `{ book: ... }` / `{ assignment: ... }`)
- **All list endpoints return `{ data: [...] }`** — paginated lists add `total`, `page`, `pageSize`; non-paginated lists just have `data`
- **All async route handlers** must be wrapped in `asyncHandler()` so unhandled errors reach the global error middleware (Express 4 does not catch async errors automatically)
- **Global error middleware** returns `{ success: false, error, code }` with Prisma code mapping (P2002→409, P2025→404)
- **Do not** invent new response shapes — follow the patterns above

### Frontend API client convention

Frontend API functions in `client/src/api/client.ts` should:

1. Accept typed parameters, return the resource directly (not the whole envelope)
2. Unwrap `data.data` for single-resource and list endpoints, so callers get the object/array directly
3. For action/delete endpoints, return `data` as-is (the `{ success: true }` object)

```typescript
// Good — caller gets the book object directly
export async function getBook(id: number) {
  const { data } = await api.get(`/books/${id}`);
  return data.data;  // unwrap { data: book }
}

// Good — caller gets the paginated result directly
export async function getBooks(params) {
  const { data } = await api.get('/books', { params });
  return data;  // { data: [...], total, page, pageSize }
}
```

The axios response interceptor already normalizes `error.message` from the server's `{ error }` field, so all `.catch()` blocks receive a human-readable message directly.

### Auth Middleware Convention

Three middleware levels exist in `server/src/middleware/auth.ts`:

| Middleware | AUTH_ENABLED=false | AUTH_ENABLED=true |
|---|---|---|
| `authRequired` | Pass through | Requires valid token |
| `teacherOrAdminRequired` | Pass through | Requires valid token + role is teacher or admin |
| `adminRequired` | Pass through | Requires valid token + isAdmin=true |

Use the appropriate middleware for each route based on the minimum access level needed.
For routes where some methods need higher access, apply the base middleware via `router.use()` and add stricter middleware to individual routes.
