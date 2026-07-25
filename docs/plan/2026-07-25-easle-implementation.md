# Easle — implementation plan

Executes `docs/spec/2026-07-25-easle-design.md`. Work happens in
`~/repos/easle` (this repo). Phases are ordered by dependency and share core
files (`db.js`, `api.js`, `main.js`), so they run **sequentially**. Commit after
each phase. Run `npm run build --workspace apps/desktop` after phases that touch
the renderer; `node -e` smoke-checks for pure-Node modules.

Canonical shapes and conventions are in `CONTRACT.md` (update it as the surface
changes).

---

## Phase 1 — Rebrand Canvas → Easle

Goal: no `@canvas/*` identifiers, no Tallyo references; product reads "Easle".
The pan/zoom **surface** component `Canvas.tsx` and the word "canvas" as a
generic surface term **stay**.

- `packages/shared/package.json`: name `@canvas/shared` → `@easle/shared`.
- `packages/mcp/package.json`: leave for now (Phase 3 deletes the package).
- `apps/desktop/package.json`: name `@canvas/desktop` → `@easle/desktop`; update
  the `@canvas/shared` dep key → `@easle/shared`.
- Root `package.json`: name `canvas` → `easle`; description → Easle.
- Grep-and-replace `@canvas/shared` import specifiers across
  `apps/desktop/electron/*.js`, `packages/mcp/server.js`.
- IPC bridge rename `window.canvas` → `window.easle`: `preload.js`
  (`contextBridge.exposeInMainWorld`), `src/store/ipc.ts` (`getCanvas`/mock +
  `window.canvas` reads), `src/store/types.ts` (global `Window` augmentation).
  Keep the `CanvasApi` type name or rename to `EasleApi` — internal, low risk.
- `main.js` `createWindow`: `title: 'Easle'`.
- `DESIGN.md`: strip the Tallyo out-of-scope line; retitle to Easle. `README.md`
  and `CONTRACT.md`: retitle to Easle.
- `npm install` (workspace names changed) then
  `npm run build --workspace apps/desktop` must pass.

**Commit:** `refactor: rebrand Canvas → Easle, strip Tallyo`

---

## Phase 2 — Projects data model

Goal: `Project → Document → Page → Node`, with migration for existing dbs.

**`packages/shared/schema.sql`** — add the `projects` table; add `project_id` to
`documents` (nullable ref, `ON DELETE CASCADE`).

**`apps/desktop/electron/db.js`**
- `mapProject(row)`.
- Migration (in `openDb`, mirroring `migratePages`): create `projects` table if
  missing; add `project_id` column if missing; if any document has
  `project_id IS NULL`, create `"Untitled Project"` and assign all orphans.
- `runSchemaAndSeed`: seed one project `"Demo"` → document `"Demo"`
  (`project_id`) → page `"Page 1"` → existing seed frame + card component.
- New methods: `listProjects()` (+ `documentCount`), `getProject(id)`
  (`{ project, documents }`), `createProject({name})`, `updateProject(id,patch)`,
  `deleteProject(id)`, `createDocument({projectId,name})`. Each mutation calls
  `emitChanged()`. Export them.

**`apps/desktop/electron/api.js`** — REST routes (keep for debugging/renderer):
`GET /projects`, `GET /project/:id`, `POST /project`, `PATCH /project/:id`,
`DELETE /project/:id`, `POST /document`.

**`apps/desktop/electron/main.js`** — add the new method names to `DB_METHODS`.

**`apps/desktop/src/store/types.ts`** — `Project` type; extend `CanvasApi`
(project/document methods).

**Renderer** — store gains `currentProjectId` / `currentDocumentId`; add a
top-bar Project picker + Document picker (small dropdowns following `PagesBar`
style). Loading resolves current project → its first document → tree.

- `npm run build --workspace apps/desktop` passes; launch, confirm seed shows a
  project with one document and the card renders.

**Commit:** `feat: projects layer above documents (+ migration)`

---

## Phase 3 — Embedded MCP over HTTP

Goal: MCP served inside the app at `127.0.0.1:47600/mcp`; no stdio process.

**`apps/desktop/electron/mcp.js`** (new) — `createMcpServer(db)` returns a
configured `McpServer` (SDK `server/mcp.js`) with the tools from Phase 4
(stub read tools here first, full surface in Phase 4). Uses `zod` for schemas.
Add `@modelcontextprotocol/sdk` + `zod` to `apps/desktop/package.json` deps.

**`apps/desktop/electron/api.js`** — route `/mcp` (POST/GET/DELETE) to a
`StreamableHTTPServerTransport` in **stateless** mode: per request, build a fresh
`McpServer` + transport (`sessionIdGenerator: undefined`), `await
server.connect(transport)`, `await transport.handleRequest(req, res, parsedBody)`,
and clean up on `res` close. Read the JSON body first (reuse `readJsonBody`).
All existing REST routes untouched.

**Remove the standalone proxy:** delete `packages/mcp/`; drop `packages/mcp` from
root `workspaces` and remove the root `mcp` script.

**Config + docs:** commit repo-root `.mcp.json`
`{ "mcpServers": { "easle": { "type": "http", "url": "http://127.0.0.1:47600/mcp" } } }`;
update `README.md` "Wire up MCP" to the HTTP snippet and "start only the app".

- Smoke: launch app; `curl -sS -X POST localhost:47600/mcp -H 'content-type:
  application/json' -H 'accept: application/json, text/event-stream' -d
  '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns the tool list.

**Commit:** `feat: embed MCP server over Streamable HTTP; drop stdio proxy`

---

## Phase 4 — Batch-first `apply(ops)`

Goal: one atomic mutation tool; reads separate.

**`apps/desktop/electron/db.js`** — `applyOps(ops)`:
- one `database.transaction`; a `Map` for `ref → id`.
- resolve `*Ref` fields (`projectRef`/`documentRef`/`pageRef`/`parentRef`, and
  `ref` in id position) against the map before dispatching.
- dispatch each op to existing internal helpers (create/update/delete/setContent/
  group/ungroup/note/version). Record `ref → newId` for create ops.
- one `emitChanged()` after commit. Return `{ refs, results }`.
- Validate op shape; throw on unknown `op` or unresolved ref (rolls back).

**`apps/desktop/electron/mcp.js`** — register:
- `apply` — zod schema for `{ ops: Op[] }` (ops as a discriminated set; accept a
  permissive object array validated in `applyOps` to keep the zod surface sane),
  calls `db.applyOps`.
- Read tools: `list_projects`, `get_project`, `get_tree`, `get_node`,
  `list_notes`, `list_versions`, `get_version`.
- Do **not** expose individual mutation tools — `apply` is the sole write path.
- Tool descriptions explain temp refs and give a one-call project-tree example.

**`main.js` `DB_METHODS`** — add `applyOps` (so the renderer/IPC can use it too).

**`CONTRACT.md`** — document `applyOps` op catalogue + the MCP tool surface.

- Smoke via `curl` (tools/call `apply`): create Project→Document→Page→2
  components in one call; assert a `refs` map returns; second `apply` patches two
  nodes; `get_tree` reflects both.

**Commit:** `feat: batch-first apply(ops) as the core MCP mutation`

---

## Done / verification

- `npm run build --workspace apps/desktop` green.
- App launches; MCP `tools/list` + `apply` round-trip works with only the app
  running.
- Fresh seed shows project→document→page→card; migrating the old
  `Canvas/data/canvas.db` (copy in for a test) puts all docs under one project.
- Push `main` to `origin`.

## Follow-up (separate, after Easle is green)

- Remove `Canvas/` from `ndis-app-swift` and commit there.
