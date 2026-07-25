# MCP authoring ergonomics + React component system

**Date:** 2026-07-25
**Status:** Draft (awaiting review)

## Goal

Remove the friction that surfaced while an agent drove Easle over MCP, and give the
canvas a **blank-slate, user/AI-defined component system** so html/css/js can be
shared instead of duplicated per node.

Two of the six reported pain points were diagnosed wrong and are corrected here; the
rest map to four independent workstreams, phased so the small wins ship first.

## Corrections to the original report

- **"No API way to reposition frames."** False. `updateNode {patch:{x,y,w,h}}`
  repositions today (`CONTRACT.md:78`, `db.js:443`). The real defect: `moveNode` —
  the intuitively-named tool — silently ignores `x/y` (`db.js:1090`). Fixed in 1a.
- **"Escaping burden" (#6)** is inherent to JSON-RPC and not separately fixable; it is
  materially reduced by `patchContent` (1c) and by component reuse (Phase 2), so it has
  no workstream of its own.

## Decisions

- **Scope:** all four workstreams (1a moveNode, 1b lean get_tree, 1c patchContent, 2 components).
- **Component runtime:** React, rendered inside the existing sandbox iframe. Chosen for
  composition/props ergonomics.
- **Blank slate — no imposed styling.** No bundled UI library, no Tailwind, no theme, no
  default reset. The component vocabulary and all styling are user/AI-defined. The tool
  ships a runtime, never a look.
- **No per-frame transpilation.** JSX is compiled to JS **once, at write time**, in the
  Electron main process via the already-present `esbuild` (0.21.5). The renderer bundle
  is React-only.
- **Non-destructive migration.** Existing `{html,css,js}` content keeps rendering via a
  legacy `Raw` path. Nothing is rewritten.
- **Sandbox preserved.** All content — legacy and React — renders in
  `sandbox="allow-scripts"` iframes, so no content can reach `window.easle` (the full
  mutation API, `preload.js`). This is load-bearing per DESIGN §7.

---

## Phase 1 — Three small, independent fixes

These are pure DB-layer / MCP-surface changes, unit-testable in isolation, and ship
before Phase 2.

### 1a. `moveNode` accepts position

In the `moveNode` case of `applyOps` (`db.js:1090`), pass `x, y, w, h` through to the
existing `updateNode` patch alongside `parentId`/`z`. No schema change.

- Op becomes: `moveNode { id|ref, parentId?|parentRef?, pageId?|pageRef?, x?, y?, w?, h?, z? }`.
- Update `CONTRACT.md:81` and the `design-review-loop` skill doc.

### 1b. Lean `get_tree`

The renderer calls `db.getTree` to draw the canvas and **needs** content, so the DB
default cannot change. Split the concern at the tool boundary:

- DB layer: `getTree(documentId, { includeContent = true } = {})`. Renderer keeps the
  default (content included).
- MCP tool `get_tree`: default `includeContent: false`. Returns nodes without
  html/css/js, but adds a `contentBytes` integer per content node so the agent knows
  what to fetch. Opt back in via `get_tree { includeContent: true }`.
- Content is still available on demand through `get_node`.

### 1c. `patchContent` op

New op for partial edits so small tweaks stop re-sending whole blobs:

```
patchContent {
  id|ref,
  edits?:  [{ field:'html'|'css'|'js', find, replace, all?:boolean }],
  append?: { html?, css?, js? }
}
```

- `find`/`replace` are literal strings. Error if `find` is absent or matches more than
  once, unless `all:true` — same contract as the Edit tool, so failures are loud, not
  silent.
- `append` concatenates to the named field(s).
- Applies within the existing `applyOps` transaction; reuses `setContent`'s write path.
- Legacy content only (operates on `contents.html/css/js`). For React content see 2.

---

## Phase 2 — React component system

### 2.0 Model overview

Everything renderable is a **React component authored as JSX source**:

- A **content node** stores its own component source (its screen/tree).
- A **shared component** (new `components` table) is a named, reusable component source,
  in scope for every node in its document.
- Both are compiled to JS at write time and executed in the sandbox iframe.
- A **`Raw`** built-in renders arbitrary/legacy `html/css/js` — the escape hatch and the
  legacy-compatibility path in one.

No component ships with styling. "Shared styles" are a document-level stylesheet + JS the
AI/user sets (2.4), empty by default.

### 2.1 Data model (non-destructive)

```sql
-- contents gains a compiled React representation; NULL => legacy html/css/js path.
ALTER TABLE contents ADD COLUMN source   TEXT;   -- JSX source authored by AI/user
ALTER TABLE contents ADD COLUMN compiled TEXT;   -- esbuild output (render factory)

-- new: per-document reusable components
CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,          -- referenced by this name from node/component source
  source TEXT NOT NULL,        -- JSX source
  compiled TEXT NOT NULL,      -- esbuild output
  css TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, name)
);

-- new: document-level shared styles/js (2.4); one row per document
CREATE TABLE IF NOT EXISTS document_assets (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  css TEXT NOT NULL DEFAULT '',
  js  TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
```

Rendering decision per content node: `source` present → React path; else → legacy path.

### 2.2 Compile-on-write (Electron main)

A new `compile.js` module wraps `esbuild.transformSync` (JSX, no bundling — React is a
provided global in the renderer). Called whenever component/node source is written
(`setContent` React variant, `createComponent`, `updateComponent`, `patchComponent`).

- Compilation happens inside the `applyOps` transaction; a syntax error throws and rolls
  back the whole batch (consistent with existing atomic semantics).
- Output stored in `compiled`; `source` retained for round-tripping/patching.

### 2.3 Renderer bundle (single, prebuilt)

A second Vite build target emits a standalone **content-renderer** bundle (React +
ReactDOM + a tiny host runtime; **no UI library**). Built once at app-build time.

- Each content iframe's `srcDoc` loads this bundle and the compiled component(s) +
  shared assets, then mounts the node's component.
- Shared components are registered in a name→component registry the node's component
  resolves against (e.g. a provided `components` object / resolver).
- `Raw` is a built-in that renders `{html,css,js}` (the legacy renderer, unchanged
  behavior).
- Because compilation already happened in main, the bundle contains **no** Babel/esbuild
  — nothing transpiles per frame.

`ContentFrame.tsx` (`:12`) branches: React node → load bundle + compiled + assets;
legacy node → current `Raw`-equivalent srcDoc. Shared css/js (2.4) injected in both.

### 2.4 Shared document styles/js

`document_assets.css` / `.js` are injected into every content iframe before the node's
own output — the "shared styles for the canvas the AI can set." Empty by default (blank
slate). New ops `setDocumentAssets { documentId?|documentRef?, css?, js? }` and read via
`get_tree`/a `get_document_assets` tool.

Icons are **not** a bundled set — an icon map + helper lives in shared js (defined once),
consistent with blank-slate.

### 2.5 MCP surface additions

```
# components
createComponent  { documentId?|documentRef?, ref?, name, source, css? }
updateComponent  { id|ref, patch:{ name?, source?, css? } }
patchComponent   { id|ref, edits?:[{field:'source'|'css', find, replace, all?}], append? }
deleteComponent  { id|ref }
list_components   (read tool) { documentId? }

# content (React variant of setContent)
setContent       { id|ref, source? , html?, css?, js? }   # source => React; else legacy
patchContent     # extended to also patch `source` (field:'source')

# shared assets
setDocumentAssets { documentId?|documentRef?, css?, js? }
```

Version snapshots (`buildSnapshot`, `db.js:717`) extend to include `source/compiled`,
components, and document_assets so restore is faithful.

### 2.6 Migration & coexistence

- No data rewrite. Legacy nodes render via `Raw` indefinitely.
- Old version snapshots lack the new fields; restore treats missing `source` as legacy.
- An agent upgrades a node by sending `setContent {source}`; the node flips to the React
  path on next render.

---

## Testing

- **1a/1b/1c:** DB-layer unit tests on `applyOps` — reposition via moveNode; lean tree
  shape + `contentBytes`; patch find/replace success, not-found error, non-unique error,
  `all`, and `append`.
- **2 compile:** `compile.js` unit tests — valid JSX compiles; syntax error throws and
  rolls back the batch.
- **2 render:** renderer-bundle tests mounting a golden set of compiled components,
  including one referencing a shared component and one `Raw`/legacy node.
- **2 migration:** a legacy `{html,css,js}` node and an old snapshot still render/restore
  after the schema change.

## Risks

- **Renderer bundle weight per iframe.** One React bundle loads per content iframe.
  Mitigation: bundle is small (React only, no UI lib), cached by the iframe; revisit a
  shared-renderer architecture only if profiling shows a problem.
- **`eval` of compiled component in-sandbox.** Contained by `sandbox="allow-scripts"`
  (no same-origin → no `window.easle`, no host DOM). This is the same trust boundary the
  app already relies on.
- **Scope.** Phase 2 is a content-model change, not an add-on. Phase 1 is independently
  shippable and should land first.

## Open sub-decision for reviewer

- **Shared-component authoring:** this spec makes shared components full **code
  components** (JSX source + own css), for maximal React ergonomics. A lighter
  alternative is **tree-template** components (composition of primitives + prop/slot
  holes, no arbitrary logic) with `Raw` for custom behavior — less power, but no code
  execution and smaller tokens. Recommendation: code components (as specified); flag if
  you'd prefer templates.
