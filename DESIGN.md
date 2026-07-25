# Easle — a local, infinite-canvas design-iteration tool

> Note: the canonical, up-to-date design is `docs/spec/2026-07-25-easle-design.md`
> (projects, embedded MCP over HTTP, batch-first `apply`). This document captures
> the original v1 architecture; "canvas" here refers both to the pan/zoom surface
> and, historically, to the product now named Easle.

## 1. Purpose

Easle is a local desktop app for **AI-authored, human-reviewed** UI design. The AI builds designs as interactive HTML/CSS/JS "content" nodes, organized on an infinite canvas with **layers and groups**. The human pans/zooms, leaves **pinned notes**, and sets status. Every iteration is **versioned**. An **MCP server** exposes the document and notes to the AI over stdio, so the AI reads feedback and pushes new versions programmatically. The two form a tight loop:

> AI authors → human reviews & annotates → AI reads notes via MCP → AI revises (new version) → repeat.

The tool is **general-purpose** (any design), not tied to any specific app.

## 2. Principles & non-goals (v1)

- **AI authors, human reviews.** In v1 only the AI creates/edits content nodes (via MCP). A user-authoring toolbar is planned but out of scope now.
- **Not a vector editor.** No pen/shape/text primitive drawing tools. Leaf designs are authored as **HTML/CSS/JS**; the tool provides *organization, annotation, and versioning* over them.
- **Local-only.** No cloud, no accounts. Electron window + local SQLite + local MCP over stdio.
- **App UI in React.** The tool chrome (canvas, layers panel, notes, version bar) is **React + Vite + TypeScript** inside Electron. This is separate from the design *content*, which stays HTML/CSS/JS.
- **Interactive designs.** Content nodes can include JS, so designs are live, not screenshots.

## 3. Architecture

All local, in one process (the MCP server is embedded — see the current spec):

```
┌─────────────────────────────────────────────┐
│ Electron app (apps/desktop)                  │
│  main process                                │
│   • better-sqlite3 (owner)                   │
│   • DB layer (single owner)                  │
│   • IPC ⇄ renderer                           │
│   • localhost JSON API + /mcp  (127.0.0.1:47600)
│       └─ embedded MCP server (Streamable HTTP) ⇄ Claude Code
│  preload (contextBridge)                     │
│  renderer (React)  ← pan/zoom canvas, layers panel, notes
└─────────────────────────────────────────────┘
        │ SQLite file
        ▼
   data/canvas.db  (WAL)
```

**Why the app owns the DB and the MCP server proxies over HTTP:** `better-sqlite3` is a native module whose binary ABI differs between Electron and plain Node. Having *both* processes open the DB directly means maintaining two incompatible native builds. Instead, the **Electron main process is the sole DB owner** and exposes a tiny **localhost JSON API**; the **stdio MCP server is a dependency-free HTTP client** to that API. One DB layer, two transports (IPC for the renderer, HTTP for MCP). Consequence: **MCP tools require the Easle app to be running** — acceptable, since iteration happens while the app is open. The MCP server connects lazily per request and returns a clear "start the Easle app" error if the API is down.

**Live refresh:** any mutation (from the renderer *or* the API) runs through the one DB layer, which then broadcasts a `db:changed` event to the renderer; the renderer reloads the affected tree/notes. So AI edits appear in the open app immediately.

## 4. Directory layout

```
easle/
  package.json               # npm workspaces: apps/*, packages/*
  DESIGN.md
  .gitignore                 # node_modules, data/*.db*
  data/                      # runtime; canvas.db (gitignored)
  apps/
    desktop/
      package.json           # electron, better-sqlite3
      electron/
        main.js              # window, DB layer wiring, IPC handlers, localhost API
        preload.js           # contextBridge: window.canvas.{tree,node,note,version,...}
        db.js                # openDb + all queries (single DB layer)
        api.js               # localhost JSON API (wraps db.js)
      src/                   # renderer (React + Vite + TS)
        main.tsx  App.tsx
        canvas/{Canvas,Node,ContentFrame,Selection}.tsx
        panels/{LayersPanel,NotesPanel,VersionBar}.tsx
        store/{store.ts,ipc.ts}         # zustand state + window.canvas IPC bridge
        styles/*.css
  packages/
    shared/                  # schema.sql + JS types/constants shared by app & mcp
      schema.sql
      types.js
    mcp/
      package.json           # @modelcontextprotocol/sdk only (no native deps)
      server.js              # stdio MCP server → HTTP client to app API
```

`.mcp.json` (repo root) registers the MCP server. (In the current design the server
is embedded in the app over HTTP — see `docs/spec/2026-07-25-easle-design.md` §3 —
so the entry is an HTTP URL rather than a spawned command.)

## 5. Data model (SQLite)

```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- node tree. type: 'frame' | 'group' | 'content'
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,   -- null = top level
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 393, h REAL NOT NULL DEFAULT 852,
  z INTEGER NOT NULL DEFAULT 0,                                -- order within parent
  visible INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_nodes_doc ON nodes(document_id);
CREATE INDEX idx_nodes_parent ON nodes(parent_id);

-- 1:1 with type='content'
CREATE TABLE contents (
  node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  html TEXT NOT NULL DEFAULT '', css TEXT NOT NULL DEFAULT '', js TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- pinned feedback. node_id null = pinned to canvas; else x/y are relative to the node
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  x REAL NOT NULL, y REAL NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'user',          -- 'user' | 'ai'
  status TEXT NOT NULL DEFAULT 'open',           -- 'open' | 'resolved' | 'wontfix'
  parent_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,  -- threaded replies
  created_at TEXT NOT NULL, resolved_at TEXT
);

-- immutable snapshots for iteration history
CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,                             -- 1,2,3… per document
  author TEXT NOT NULL,                           -- 'ai' | 'user'
  summary TEXT NOT NULL,
  snapshot TEXT NOT NULL,                         -- JSON: full nodes+contents tree
  created_at TEXT NOT NULL
);
```

The **live** document is `nodes`+`contents` (mutable). A **version** is an immutable JSON snapshot with a summary. *Restore* loads a snapshot back into the live tables; *compare* diffs two snapshots (or a snapshot vs live).

## 6. Renderer / UX

- **Infinite canvas:** CSS-transform pan (space-drag / scroll) + zoom (ctrl/⌘-scroll), zoom-to-fit, zoom %. Renders the node tree; frames/groups are boxes; content nodes render their design.
- **Selection & manipulation:** click to select, shift-click multi-select, drag to move, handles to resize, arrow-key nudge. Respects `locked`/`visible`.
- **Layers panel (left):** the node tree — expand/collapse, drag to reorder/reparent, rename (double-click), hide (eye), lock. **Group/ungroup** selection (⌘G / ⌘⇧G) creates/removes `group` nodes.
- **Notes:** note tool (N) → click a point → compose a note; note pins render as pins on the canvas; a **notes sidebar (right)** lists notes with status filter, jump-to, resolve, and reply. AI notes and user notes are visually distinct.
- **Versions:** a version bar — "Save version" (with summary), history list, open a version read-only, **compare two versions side-by-side**, restore.
- **Empty/seed:** ships one seed document so the canvas isn't blank on first run.

## 7. Content rendering & sandboxing

Each `content` node renders in a sandboxed `<iframe srcdoc>` built from its `html`/`css`/`js` (plus optional shared assets). `sandbox="allow-scripts"` isolates styles and script from the tool and from sibling nodes, so interactive designs can't break the editor. The iframe is sized to the node's w/h and scaled by the canvas zoom. Pointer events on the iframe are gated by an overlay so canvas gestures (select/move) win unless the node is "entered" for interaction.

## 8. DB layer, IPC & local API

**One DB layer** (`db.js`) exposes functions: `getTree`, `getNode`, `createNode`, `updateNode`, `deleteNode`, `setContent`, `groupNodes`, `ungroup`, `listNotes`, `createNote`, `updateNote`, `resolveNote`, `saveVersion`, `listVersions`, `getVersion`, `restoreVersion`. Every mutation bumps `updated_at` and emits `db:changed`.

- **Renderer ⇄ main:** `preload.js` exposes `window.canvas.*` via `contextBridge` + `ipcRenderer.invoke`, mapping 1:1 to the DB layer, plus an `onChanged(cb)` subscription.
- **MCP ⇄ main:** `api.js` serves the same functions as JSON over `127.0.0.1:47600` (loopback only). CORS/off; no external exposure.

## 9. MCP server surface (stdio)

Tools (thin wrappers over the localhost API):

| Tool | Purpose |
|---|---|
| `list_documents` | documents + current version number |
| `get_tree(documentId?)` | full node tree (ids, types, names, geometry, hierarchy) |
| `get_node(id)` | one node; for content nodes includes html/css/js |
| `create_node({documentId, parentId?, type, name, x,y,w,h})` | add frame/group/content |
| `update_node(id, {name?,x?,y?,w?,h?,z?,visible?,locked?,parentId?})` | edit node |
| `set_content(id, {html?,css?,js?})` | author/replace a content node's design |
| `delete_node(id)` | remove node (+subtree) |
| `group_nodes({nodeIds, name?})` / `ungroup(groupId)` | grouping |
| `list_notes({status?, documentId?})` | read feedback (default: open) |
| `resolve_note(id, {resolution})` | mark resolved/wontfix |
| `add_version({documentId, summary})` | snapshot current state |
| `list_versions(documentId)` / `restore_version(id)` | history |

Resource: `canvas://document/<id>/tree` (read-only tree JSON). All tools return compact JSON; errors are actionable (e.g. "Easle app not running — start it and retry").

## 10. Iteration loop (sequence)

1. AI: `create_node(type:'frame')` → `create_node(type:'content', parent)` → `set_content(html,css,js)` → `add_version("v1: initial")`.
2. Human: reviews in the app, pins notes, sets status.
3. AI: `list_notes({status:'open'})` → edits nodes/content to address each → `resolve_note(...)` → `add_version("v2: addressed nav + spacing notes")`.
4. Human: compares v1↔v2, leaves more notes. Repeat.

## 11. Tech stack & risks

- **Electron** (shell), **React + Vite + TypeScript** (renderer) with **zustand** for state, **better-sqlite3** (DB, app only), **@modelcontextprotocol/sdk** (stdio MCP), Node HTTP (localhost API). Node 20.19+ present; Electron bundles its own Node. `electron-vite` scaffolds main/preload/renderer with HMR.
- **Risk — better-sqlite3 for Electron ABI:** rebuild via `@electron/rebuild` postinstall in `apps/desktop`. The MCP package has **no native deps** (HTTP client only), sidestepping ABI conflicts entirely.
- **Risk — iframe interaction vs canvas gestures:** overlay-gating (Section 7); default to canvas gestures, explicit "enter" to interact.
- **Risk — MCP needs the app running:** documented; lazy connect + clear error. (A future headless read-only DB mode could lift this.)
- **Risk — concurrent writes:** avoided — single DB owner (Electron main).

## 12. v1 scope checklist

- [ ] Workspace scaffold (`apps/desktop`, `packages/{shared,mcp}`), `.gitignore`, schema + migration + seed document.
- [ ] Electron shell: window, `db.js` layer, IPC handlers, preload bridge.
- [ ] Renderer: pan/zoom canvas rendering the node tree; content nodes in sandboxed iframes.
- [ ] Selection, move, resize, arrow-nudge; visible/locked respected.
- [ ] Layers panel: tree, reorder/reparent, rename, hide/lock, group/ungroup.
- [ ] Notes: pin tool, canvas pins, sidebar list/filter/resolve/reply; AI vs user styling.
- [ ] Versions: save/list/open/compare/restore.
- [ ] localhost JSON API wrapping the DB layer; `db:changed` live refresh.
- [ ] stdio MCP server implementing the tools above; `.mcp.json` snippet documented.
- [ ] Seed demo document proving the full loop.

## 13. Out of scope / later

User-authoring toolbar (create/edit content in-app), visual pixel-diff between versions, richer note-thread UI, multi-document workspace switching, export (PNG/HTML bundle), packaging/installers, and importing external design sets as content.
