# Easle — design spec

**Date:** 2026-07-25
**Status:** approved (design), ready for implementation plan

Easle is a local, Figma-style **AI-authored / human-reviewed** design-iteration
tool. The AI builds interactive HTML/CSS/JS designs as nodes on an infinite
canvas; the human pans/zooms, pins notes, and sets status; every iteration is
versioned. This spec covers four changes that take the tool from its origin as
"Canvas" (embedded in the Tallyo `ndis-app-swift` monorepo) to a standalone
product:

1. **Rebrand** Canvas → Easle and strip all Tallyo coupling.
2. **Projects** — a new top level so one install manages many documents.
3. **Embedded MCP** — the MCP server runs *inside* the desktop app over HTTP;
   no separate process, one thing to start.
4. **Batch-first MCP** — a single atomic `apply(ops)` tool is the core mutation
   path. Claude creates whole projects/documents/pages/components and patches
   many nodes in one call.

Everything else (Electron shell, SQLite/WAL storage, React renderer, notes,
versions, sandboxed iframe content) stays as-is.

---

## 1. Rebrand: Canvas → Easle

**Product name** is Easle. The word "canvas" still legitimately names the
*infinite pan/zoom surface* — the `Canvas.tsx` component and "the canvas" in UI
copy keep that generic meaning. Only the **brand/package/identifier** layer
changes.

- Package scopes: `@canvas/shared` → `@easle/shared`, `@canvas/desktop` →
  `@easle/desktop`. The `@canvas/mcp` package is **deleted** (see §3).
- Root package name `canvas` → `easle`; drop the `mcp` npm script.
- IPC bridge global `window.canvas` → `window.easle` (preload.js, `ipc.ts`,
  `types.ts` — contained rename).
- Window title, README, DESIGN.md, CONTRACT.md updated to Easle.
- Strip the single Tallyo reference in `DESIGN.md` (the out-of-scope note about
  "importing the Tallyo mockups"). No other Tallyo/NDIS references exist.
- MCP server identity: `name: "easle"`.

This is mechanical but touches many files; it lands first so later work is on
Easle-named code.

---

## 2. Data model: Projects

### Hierarchy

```
Project → Document → Page → Node (frame | group | component)
```

- **Project** — new top-level entity. Groups many documents. This is what lets
  one Easle install hold designs for several apps/features at once.
- **Document** — unchanged, gains `project_id`.
- **Page** — unchanged (Figma-style page grouping top-level frames).
- **Node** — unchanged shapes. A **`content` node is addressed as a
  "component"** in the MCP vocabulary (its html/css/js is the design). `frame`
  and `group` remain layout containers.

### Schema

New table + one column (added via the same idempotent migration pattern already
used for `pages` in `db.js`):

```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE documents ADD COLUMN project_id
  INTEGER REFERENCES projects(id) ON DELETE CASCADE;
```

### Migration & seed

- **Migration (existing dbs):** on `openDb`, if any document has
  `project_id IS NULL`, create a default project `"Untitled Project"` and assign
  all orphan documents to it. Mirrors the existing `migratePages()` logic.
- **Seed (fresh db):** create one project `"Demo"` → one document `"Demo"` →
  one page `"Page 1"` → the existing seed frame + card component, so a new
  install isn't blank.

### DB layer additions (`db.js`)

New methods, same synchronous style, each calling `emitChanged()`:

```
listProjects(): Project[]                         // each with documentCount
getProject(id): { project, documents }            // documents = list under it
createProject({name}): Project
updateProject(id, patch): Project                 // patch: name
deleteProject(id): { ok }                         // cascades documents→pages→nodes
```

`createDocument({projectId,name})` is added (documents were previously only
seeded); `getTree`/`listDocuments` gain a `project_id` filter where useful.

`Project = { id, name, createdAt, updatedAt }`. Booleans/timestamps follow the
existing CONTRACT conventions.

---

## 3. Embedded MCP over HTTP

### Problem

Today the MCP server (`packages/mcp/server.js`) is a **separate stdio process**
that proxies HTTP to the Electron app's loopback API — so there are two things
in play and the app *must already be running* for MCP to work, which is easy to
get wrong.

### Design

Mount the MCP server **inside the Electron main process**, calling the `db`
layer **directly** (no HTTP self-proxy hop), exposed over the SDK's
**Streamable HTTP transport** on the existing loopback server
(`127.0.0.1:47600`, path `/mcp`). `@modelcontextprotocol/sdk@1.29` ships
`server/streamableHttp.js`.

- New module `apps/desktop/electron/mcp.js`: builds the `McpServer`, registers
  tools (§4) whose handlers call `db.*` directly.
- `api.js` routes `POST/GET/DELETE /mcp` to the transport; all existing REST
  routes stay (the renderer still uses them via IPC; REST remains handy for
  debugging).
- **Stateless mode:** per request, instantiate `McpServer` +
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, `connect`,
  `handleRequest(req, res, body)`, and dispose on response close. Simplest and
  robust for a local single-user tool; no session bookkeeping.
- **Delete** `packages/mcp/` and drop it from workspaces + root scripts.

### Consumer config

`.mcp.json` (in the project where Claude Code runs — e.g. any repo you're
designing for) becomes an HTTP entry, documented in the README:

```json
{ "mcpServers": { "easle": { "type": "http", "url": "http://127.0.0.1:47600/mcp" } } }
```

A dogfood `.mcp.json` is committed at the Easle repo root too. Start the app →
MCP is live. Nothing else to launch. If the app is down, Claude Code simply
can't reach the URL — a clear, single failure mode.

---

## 4. Batch-first MCP surface

**Principle:** bulk create and multi-patch are the norm, not one-node-at-a-time.
A single atomic tool, **`apply`**, is the core mutation path.

### `apply({ ops })`

- Runs **all ops in one SQLite transaction**; any op throws → whole call rolls
  back.
- Ops execute in array order.
- **Temp refs** let one call build a whole tree: a create op may declare
  `ref: "<string>"`; later ops reference it via `projectRef` / `documentRef` /
  `pageRef` / `parentRef` (and `ref` in id position where noted). The server
  resolves refs → real ids in order and returns the map.
- Returns `{ ok: true, refs: { "<ref>": <id> }, results: [ ... ] }`.

**Op catalogue** (discriminated by `op`):

Create (each accepts optional `ref`; parent links accept a real id *or* a
`*Ref`):
```
createProject   { ref?, name }
createDocument  { ref?, projectId?|projectRef?, name }
createPage      { ref?, documentId?|documentRef?, name, idx? }
createNode      { ref?, documentId?|documentRef?, pageId?|pageRef?,
                  parentId?|parentRef?, type:'frame'|'group'|'content',
                  name?, x?, y?, w?, h?, z?, content?:{html?,css?,js?} }
                  // type:'content' + content → component authored in one op
```

Patch (partial — any subset of fields; **this is the emphasised path**):
```
updateProject   { id, patch:{name?} }
updateDocument  { id, patch:{name?, projectId?} }
updatePage      { id, patch:{name?, idx?} }
updateNode      { id|ref, patch:{name?,x?,y?,w?,h?,z?,visible?,locked?,parentId?,pageId?} }
setContent      { id|ref, html?, css?, js? }
```

Structure / lifecycle:
```
moveNode        { id|ref, parentId?|parentRef?, pageId?|pageRef?, z? }   // sugar over updateNode
groupNodes      { ref?, nodeIds:[id|ref], name? }
ungroup         { groupId }
deleteNode      { id }
deletePage      { id }
deleteDocument  { id }
deleteProject   { id }
```

Review:
```
createNote      { documentId?|documentRef?, nodeId?, x, y, body, author? }  // AI replies
resolveNote     { id, resolution?:'resolved'|'wontfix' }
addVersion      { documentId?|documentRef?, summary }
restoreVersion  { id }
```

### Read tools (separate, non-batched)

```
list_projects                      // projects + documentCount
get_project     { id }             // project + its documents
get_tree        { documentId }     // flat node tree; components include content
get_node        { id }
list_notes      { documentId, status? }   // default open
list_versions   { documentId }
get_version     { id }
```

### Rationale for a single mutation tool

Exposing `apply` as **the** write tool (plus the reads above) keeps the surface
small and forces the batch/patch idiom. Under the hood `apply` dispatches to the
existing `db.js` methods, so single-edit behaviour is preserved — a one-op
`apply` is just a small batch.

### DB layer: `applyOps(ops)`

`db.js` gains `applyOps(ops): { refs, results }` — opens one transaction,
maintains a `ref → id` map, dispatches each op to the existing internal
create/update/delete helpers (resolving `*Ref` fields first), and emits a single
`emitChanged()` after commit (one live-refresh for the whole batch).

---

## 5. Renderer

Minimal, following existing patterns (`PagesBar` already exists for pages):

- A top-bar **Project picker** and **Document picker** (dropdowns) so the human
  can switch which project/document the canvas shows. Store gains
  `currentProjectId` / `currentDocumentId`.
- `db:changed` live-refresh already covers batch edits (one event per `apply`).
- No change to the canvas surface, layers, notes, or version UI.

---

## 6. Out of scope

- History-preserving extraction (fresh history chosen).
- Auth / multi-user / cloud sync (stays local-only).
- User-authoring toolbar, pixel-diff, export bundles (unchanged from prior
  backlog).
- Per-project auto-binding to a repo path (future nicety; projects are selected
  by id/name for now).

---

## 7. Acceptance

- App builds and launches; MCP reachable at `http://127.0.0.1:47600/mcp` with
  the app running; no separate MCP process.
- `apply` creates a full Project → Document → Page → components tree in one call
  and returns a ref→id map; a second `apply` patches multiple nodes atomically.
- Existing `canvas.db` migrates: all prior documents fall under one default
  project; nothing lost.
- No `@canvas/*` identifiers, no Tallyo references remain.
