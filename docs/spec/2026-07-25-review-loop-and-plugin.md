# Easle — in-app review loop + Claude Code plugin

Status: approved design. Extends `2026-07-25-easle-design.md` and CONTRACT.md.

## Goal

1. **In-app blocking review loop.** The AI authors a version, then *parks* while the
   user reviews **inside the Easle app** (leaves notes, requests changes), presses
   **Submit review** or **Approve & continue**, and the AI wakes, iterates, and shows
   the next version — repeating until the user approves, then the AI continues its
   broader task. No round-trip back to the chat to hand feedback over.
2. **Delete from the AI.** Already supported via `apply` (`deleteNode` / `deletePage`
   / `deleteDocument` / `deleteProject`). No code change — the skill teaches it.
3. **Claude Code plugin.** A one-install package that wires the Easle MCP server *and*
   ships a skill teaching the review loop + delete, distributable from this repo.

## Part A — In-app review loop

### State model

A document carries a `review_state`: `idle | awaiting | changes_requested | approved`.

```
        apply(... addVersion, requestReview)        Submit review
 idle ───────────────────────────────────▶ awaiting ──────────────▶ changes_requested
   ▲                                          │                            │
   │                                          │ Approve & continue         │ wait_for_review consumes
   │                                          ▼                            ▼
   └──────────────── wait_for_review consumes  approved ──────────────▶ (returns to AI) → idle
```

- **AI** sets `awaiting` via the `requestReview` op (batched with `addVersion`).
- **User** (in app) sets `changes_requested` (Submit review) or `approved` (Approve & continue).
- **`wait_for_review`** (MCP tool) polls; when state is `changes_requested`/`approved`
  it **consumes** the signal (resets to `idle`) and returns the outcome + open user notes.

### DB layer (`db.js` + `schema.sql`)

- `documents.review_state TEXT NOT NULL DEFAULT 'idle'` — added to `schema.sql` and via
  an idempotent `migrateReview()` ALTER for existing dbs.
- `mapDocument` surfaces `reviewState` (so `getTree().document` carries it → the renderer
  updates live on `db:changed`).
- New methods (all `emitChanged()` after write, mirror existing style):
  - `getReviewState(documentId) -> { documentId, state }`
  - `requestReview(documentId) -> { ok, state:'awaiting' }`
  - `submitReview(documentId) -> { ok, state:'changes_requested' }`
  - `approveReview(documentId) -> { ok, state:'approved' }`
  - `consumeReview(documentId) -> { state, consumed:boolean }` — in one txn: if state is
    `changes_requested`/`approved`, reset to `idle` and report the prior state; else report
    current state unchanged.
- New `applyOps` op: `requestReview { documentId?|documentRef? }`.

### MCP surface (`mcp.js`)

- `requestReview` reachable through `apply` (documented in the `apply` tool text).
- New tool **`wait_for_review { documentId?, timeoutMs? }`** (default first document,
  default/cap `timeoutMs` 25000):
  - Poll `getReviewState` every 500ms up to `timeoutMs`.
  - On `changes_requested` → `consumeReview` → `{ status:'changes_requested', notes:<open user notes>, latestVersion }`.
  - On `approved` → `consumeReview` → `{ status:'approved', notes:<open user notes> }`.
  - On timeout still `awaiting`/`idle` → `{ status:'pending', state }`. The skill re-calls
    while `pending`, so the AI waits across turns without any single request stalling
    (robust against MCP client timeouts).
- New read tool **`get_review_state { documentId? }`** → `{ state }` (non-blocking peek).
- `notes` returned are open notes authored by the user (the review feedback).

### App (renderer)

- `types.ts`: `ReviewState` type; `reviewState` on `CanvasDocument`; new `CanvasApi`
  methods (`getReviewState`, `requestReview`, `submitReview`, `approveReview`, `consumeReview`).
- `store.ts`: read `document.reviewState` (already loaded via `getTree`); actions
  `submitReview()` / `approveReview()` (write-through + reload).
- New **`ReviewBar`** component, rendered in `App.tsx` under `VersionBar`, visible only
  when `reviewState === 'awaiting'`: a banner "The AI is waiting for your review — leave
  notes, then submit" with **Submit review** and **Approve & continue** buttons.
- `app.css`: styles for the review bar (distinct accent so it reads as a blocking state).

### IPC wiring

- Add the new DB method names to `preload.js` `METHODS` and `main.js` `DB_METHODS`.

## Part B — Claude Code plugin

Distributed as a marketplace from this repo:

```
.claude-plugin/marketplace.json     # lists the "easle" plugin → ./plugins/easle
plugins/easle/
  .claude-plugin/plugin.json         # manifest (name, version, author, Apache-2.0)
  .mcp.json                          # easle http server @ 127.0.0.1:47600/mcp
  skills/easle/SKILL.md              # the workflow skill
```

Install UX (README):

```
/plugin marketplace add dknathalage/easle
/plugin install easle@easle
```

### The skill (`easle`)

Triggers when the user wants to design/iterate UI in Easle. Teaches:
- **Author** a Project→Document→Page→node tree in one `apply(ops)` call using temp `ref`s;
  leaf designs are self-contained HTML/CSS/JS `content` nodes, frames are screens.
- **The blocking loop:** `apply([...changes, addVersion, requestReview])` →
  call `wait_for_review` repeatedly while `status:'pending'` →
  on `changes_requested`: revise via `apply`, `resolveNote` each addressed note,
  `addVersion`, `requestReview` again → repeat →
  on `approved`: stop and continue the broader task.
- **Delete** via `apply` (`deleteNode`/`deletePage`/`deleteDocument`/`deleteProject`).
- **Guardrails:** `apply` is the only write path; always `addVersion` after a round;
  resolve notes you addressed; if tools error with "start the Easle app", the app is down.

## Out of scope (YAGNI)

Slash commands, hooks, multi-user/concurrent review, per-note "request change" flags
(open user notes already express requested changes).

## Testing

- DB: state transitions (request→submit→consume, request→approve→consume, consume on idle).
- MCP: `wait_for_review` returns `pending` on timeout, resolves on submit/approve, consumes once.
- App: ReviewBar shows only on `awaiting`; buttons drive state; live refresh via `db:changed`.
- Manual: run app, drive the loop from Claude Code end-to-end.
