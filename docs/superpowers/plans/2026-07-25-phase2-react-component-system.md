# Phase 2: React Component System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI/users author content as React components (JSX) with reusable, per-document shared components and document-level shared styles — on a blank slate, no imposed styling — rendered inside the existing sandbox iframe.

**Architecture:** JSX is compiled to plain JS **once at write time** in the Electron main process via `esbuild` (already present, 0.21.5). Compiled output is stored in SQLite. A single prebuilt **content-renderer** bundle (React only, no UI library) is loaded inside each content iframe; it evals the compiled component, resolves shared components by name, injects shared css/js, and mounts. Legacy `{html,css,js}` content keeps rendering via a `Raw` path, so nothing is rewritten.

**Tech Stack:** Node/CommonJS (main), esbuild, better-sqlite3, React 18 + ReactDOM, Vite (second build target), Vitest (+ jsdom for renderer tests).

## Global Constraints

- **Blank slate:** ship NO UI component library, NO Tailwind, NO theme, NO default CSS reset. The renderer provides only React + a host runtime.
- **Non-destructive:** `contents.source` NULL ⇒ legacy html/css/js path. Never rewrite existing content or old version snapshots.
- **Sandbox preserved:** all content renders in `sandbox="allow-scripts"` iframes. Compiled component code is eval'd only inside that iframe, never in the host renderer.
- **No per-frame transpilation:** the renderer bundle contains no esbuild/Babel. Compilation happens in main and is cached in `contents.compiled` / `components.compiled`.
- **Atomic writes:** compilation runs inside the `applyOps` transaction; a compile error throws and rolls back the whole batch.
- Depends on Phase 1's Vitest harness (`electron/__tests__/helpers.js`, `makeDb()`). If executed before Phase 1 merges, add the Task 0 harness from the Phase 1 plan first.

## Parallel Tracks

After **Task 1 (schema)** lands, three tracks run in parallel in separate worktrees:

- **Track C — Compile module** (Tasks 2): `electron/compile.js`. Zero shared files. Interface locked below.
- **Track R — Renderer bundle** (Tasks 6–7): Vite entry + `src/content-renderer/*` + `ContentFrame.tsx`. Overlaps only `types.ts` (owned by Track S).
- **Track S — DB/MCP spine** (Tasks 3, 4, 5, 8): `db.js`, `mcp.js`, `types.ts`, `CONTRACT.md`. Serial within itself; consumes Track C's `compileJsx`.

**Locked cross-track interfaces:**
- `compileJsx(source, opts?) → { code: string }` (Track C) — throws `Error` on invalid JSX. Task 3 (Track S) consumes it.
- **Renderer message contract** (Track R consumes, Track S/renderer produce): the iframe is handed a payload
  ```ts
  type RenderPayload = {
    mode: 'react' | 'raw';
    compiled?: string;                       // react: node component factory (CJS)
    components?: Record<string, string>;     // react: name -> compiled factory (CJS)
    assets: { css: string; js: string };     // shared document css/js (may be empty)
    raw?: { html: string; css: string; js: string }; // raw mode only
  };
  ```

---

### Task 1: Schema migration (Track S — must land first)

**Files:**
- Modify: `apps/desktop/electron/schema.sql`
- Modify: `apps/desktop/electron/db.js` — add a migration IIFE in `openDb` (alongside the others, ~`:236`)
- Test: `apps/desktop/electron/__tests__/schema.test.js`

**Interfaces:**
- Produces: `contents.source TEXT`, `contents.compiled TEXT` (nullable); tables `components(id, document_id, name, source, compiled, css, created_at, updated_at, UNIQUE(document_id,name))` and `document_assets(document_id PK, css, js, updated_at)`.

- [ ] **Step 1: Failing test**

Create `apps/desktop/electron/__tests__/schema.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

test('new columns and tables exist', () => {
  const db = makeDb();
  const cols = db._raw.prepare('PRAGMA table_info(contents)').all().map((c) => c.name);
  expect(cols).toContain('source');
  expect(cols).toContain('compiled');
  const tables = db._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  expect(tables).toContain('components');
  expect(tables).toContain('document_assets');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/schema.test.js` → FAIL.

- [ ] **Step 3: Add tables to `schema.sql`** (append after `contents`):
```sql
CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  compiled TEXT NOT NULL,
  css TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, name)
);
CREATE TABLE IF NOT EXISTS document_assets (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  css TEXT NOT NULL DEFAULT '',
  js  TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Add a migration IIFE in `db.js`** (after `migrateReview`, ~`:242`), so existing DBs gain the `contents` columns:
```js
  (function migrateComponents() {
    const cols = database.prepare('PRAGMA table_info(contents)').all().map((c) => c.name);
    if (!cols.includes('source')) database.exec('ALTER TABLE contents ADD COLUMN source TEXT');
    if (!cols.includes('compiled')) database.exec('ALTER TABLE contents ADD COLUMN compiled TEXT');
    // components + document_assets tables come from schema.sql (IF NOT EXISTS, run on open)
  })();
```

- [ ] **Step 5: Run to verify it passes** → `npx vitest run electron/__tests__/schema.test.js` PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/desktop/electron/schema.sql apps/desktop/electron/db.js apps/desktop/electron/__tests__/schema.test.js
git commit -m "feat(schema): components, document_assets, contents.source/compiled"
```

---

### Task 2: `compile.js` — JSX → JS (Track C, parallel)

**Files:**
- Create: `apps/desktop/electron/compile.js`
- Test: `apps/desktop/electron/__tests__/compile.test.js`

**Interfaces:**
- Consumes: `esbuild` (already a transitive dep via Vite; add as explicit devDep).
- Produces: `compileJsx(source, opts?) → { code }`. `code` is CommonJS that assigns the default export to `module.exports.default`. JSX pragma targets a global `React`. Throws on syntax error.

- [ ] **Step 1: Add esbuild explicitly**

In `apps/desktop/package.json` devDependencies add `"esbuild": "^0.21.5"`. Run `npm install`.

- [ ] **Step 2: Failing test**

Create `apps/desktop/electron/__tests__/compile.test.js`:
```js
const { test, expect } = require('vitest');
const { compileJsx } = require('../compile.js');

test('compiles JSX to JS referencing global React', () => {
  const { code } = compileJsx('export default function App(){ return <div className="a">hi</div> }');
  expect(typeof code).toBe('string');
  expect(code).toMatch(/React\.createElement/);
});

test('throws on invalid JSX', () => {
  expect(() => compileJsx('export default function(){ return <div> }')).toThrow();
});
```

- [ ] **Step 3: Run to verify it fails** → FAIL (module missing).

- [ ] **Step 4: Implement `compile.js`**
```js
// Compile AI/user-authored JSX to CommonJS once, at write time (Electron main).
// The renderer bundle provides `React` as a global; classic runtime keeps output
// dependency-free (no import of a jsx-runtime).
const esbuild = require('esbuild');

function compileJsx(source, opts = {}) {
  const result = esbuild.transformSync(source, {
    loader: 'jsx',
    format: 'cjs',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    sourcefile: opts.filename || 'component.jsx',
  });
  return { code: result.code };
}

module.exports = { compileJsx };
```

- [ ] **Step 5: Run to verify it passes** → PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/desktop/package.json apps/desktop/electron/compile.js apps/desktop/electron/__tests__/compile.test.js package-lock.json
git commit -m "feat(compile): esbuild JSX->CJS compile module"
```

---

### Task 3: React content via `setContent {source}` (Track S)

**Files:**
- Modify: `apps/desktop/electron/db.js` — `setContent` (`:486`), `createNode` content path, `getNode`/`getTree` mappers, `mapContent` (`:60`)
- Test: `apps/desktop/electron/__tests__/reactContent.test.js`

**Interfaces:**
- Consumes: `compileJsx` from Task 2.
- Produces: `setContent(id, { source })` compiles and stores `source`+`compiled`; when `source` given, `html/css/js` are left as-is (legacy fields ignored for react nodes). `mapContent` returns `{ html, css, js, source, compiled }`. A content node's `content` includes `source`/`compiled` when present.

- [ ] **Step 1: Failing test**

Create `apps/desktop/electron/__tests__/reactContent.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

function seedContent(db) {
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
    { op: 'createNode', ref: 'c', documentRef: 'd', type: 'content', name: 'C', content: { html: '' } },
  ]);
  return refs.c;
}

test('setContent with source compiles and stores it', () => {
  const db = makeDb();
  const id = seedContent(db);
  db.applyOps([{ op: 'setContent', id, source: 'export default () => <div>hi</div>' }]);
  const c = db.getNode(id).content;
  expect(c.source).toMatch(/<div>hi<\/div>/);
  expect(c.compiled).toMatch(/React\.createElement/);
});

test('invalid source rolls back the batch', () => {
  const db = makeDb();
  const id = seedContent(db);
  expect(() =>
    db.applyOps([{ op: 'setContent', id, source: 'export default () => <div>' }])
  ).toThrow();
  expect(db.getNode(id).content.source == null).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Extend `mapContent`** (`:60`):
```js
function mapContent(row) {
  if (!row) return null;
  return { html: row.html, css: row.css, js: row.js, source: row.source ?? null, compiled: row.compiled ?? null };
}
```

- [ ] **Step 4: Extend `setContent`** to accept `source`. At the top of `db.js` add `const { compileJsx } = require('./compile.js');`. Then in `setContent` (`:486`), after resolving `existing`, handle source:
```js
  function setContent(id, { html, css, js, source } = {}) {
    const row = getNodeRow(id);
    if (!row) throw new Error(`Node ${id} not found`);
    if (row.type !== 'content') throw new Error(`Node ${id} is not a content node`);
    const ts = now();
    const compiled = source != null ? compileJsx(source, { filename: `node-${id}.jsx` }).code : null;
    const tx = database.transaction(() => {
      let existing = getContentRow(id);
      if (!existing) {
        database.prepare('INSERT INTO contents (node_id, html, css, js, updated_at) VALUES (?,?,?,?,?)').run(id, '', '', '', ts);
        existing = getContentRow(id);
      }
      const nextHtml = html != null ? html : existing.html;
      const nextCss = css != null ? css : existing.css;
      const nextJs = js != null ? js : existing.js;
      const nextSource = source != null ? source : existing.source;
      const nextCompiled = source != null ? compiled : existing.compiled;
      database
        .prepare('UPDATE contents SET html=?, css=?, js=?, source=?, compiled=?, updated_at=? WHERE node_id=?')
        .run(nextHtml, nextCss, nextJs, nextSource, nextCompiled, ts, id);
      database.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').run(ts, id);
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return { ok: true };
  }
```
Note: `compileJsx` runs before the transaction so a throw aborts cleanly (still inside the outer `applyOps` tx → whole batch rolls back).

- [ ] **Step 5: Run to verify it passes** → PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/desktop/electron/db.js apps/desktop/electron/__tests__/reactContent.test.js
git commit -m "feat(mcp): setContent accepts React source (compile-on-write)"
```

---

### Task 4: Shared components CRUD (Track S)

**Files:**
- Modify: `apps/desktop/electron/db.js` — add `listComponents/createComponent/updateComponent/patchComponent/deleteComponent`; `applyOps` cases; exports
- Modify: `apps/desktop/electron/mcp.js` — `list_components` read tool; op catalogue text
- Test: `apps/desktop/electron/__tests__/components.test.js`

**Interfaces:**
- Consumes: `compileJsx`.
- Produces:
  - `createComponent({documentId, name, source, css})` → `{id, documentId, name, source, compiled, css}`
  - `updateComponent(id, patch)` (name/source/css; recompiles if source changes)
  - `patchComponent(id, {edits:[{field:'source'|'css',find,replace,all?}], append})` (recompiles)
  - `deleteComponent(id)`; `listComponents(documentId)`
  - ops: `createComponent/updateComponent/patchComponent/deleteComponent`; refs supported like other creates.

- [ ] **Step 1: Failing test**

Create `apps/desktop/electron/__tests__/components.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

function doc(db) {
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
  ]);
  return refs.d;
}

test('create + list component compiles source', () => {
  const db = makeDb();
  const d = doc(db);
  db.applyOps([{ op: 'createComponent', documentId: d, name: 'Button', source: 'export default ({label}) => <button>{label}</button>' }]);
  const list = db.listComponents(d);
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe('Button');
  expect(list[0].compiled).toMatch(/React\.createElement/);
});

test('patchComponent edits source and recompiles', () => {
  const db = makeDb();
  const d = doc(db);
  const { refs } = db.applyOps([{ op: 'createComponent', ref: 'b', documentId: d, name: 'B', source: 'export default () => <i>one</i>' }]);
  db.applyOps([{ op: 'patchComponent', id: refs.b, edits: [{ field: 'source', find: 'one', replace: 'two' }] }]);
  expect(db.listComponents(d)[0].source).toMatch(/two/);
});

test('duplicate name in a document is rejected', () => {
  const db = makeDb();
  const d = doc(db);
  db.applyOps([{ op: 'createComponent', documentId: d, name: 'Dup', source: 'export default () => <i/>' }]);
  expect(() =>
    db.applyOps([{ op: 'createComponent', documentId: d, name: 'Dup', source: 'export default () => <b/>' }])
  ).toThrow();
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement CRUD in `db.js`** (place near versions/pages helpers). Follow existing mapper/transaction style:
```js
  function mapComponent(r) {
    if (!r) return null;
    return { id: r.id, documentId: r.document_id, name: r.name, source: r.source, compiled: r.compiled, css: r.css, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  function listComponents(documentId) {
    if (!documentId) throw new Error('listComponents: documentId is required');
    return database.prepare('SELECT * FROM components WHERE document_id = ? ORDER BY name ASC').all(documentId).map(mapComponent);
  }
  function getComponentRow(id) { return database.prepare('SELECT * FROM components WHERE id = ?').get(id); }
  function createComponent({ documentId, name, source, css } = {}) {
    if (!documentId) throw new Error('createComponent: documentId is required');
    if (!name) throw new Error('createComponent: name is required');
    if (source == null) throw new Error('createComponent: source is required');
    const compiled = compileJsx(source, { filename: `component-${name}.jsx` }).code;
    const ts = now();
    const info = database
      .prepare('INSERT INTO components (document_id, name, source, compiled, css, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(documentId, name, source, compiled, css != null ? css : '', ts, ts);
    touchDocument(documentId, ts);
    emitChanged();
    return mapComponent(getComponentRow(info.lastInsertRowid));
  }
  function updateComponent(id, patch = {}) {
    const row = getComponentRow(id);
    if (!row) throw new Error(`Component ${id} not found`);
    const ts = now();
    const nextSource = 'source' in patch ? patch.source : row.source;
    const nextCompiled = 'source' in patch ? compileJsx(nextSource, { filename: `component-${id}.jsx` }).code : row.compiled;
    const nextName = 'name' in patch ? patch.name : row.name;
    const nextCss = 'css' in patch ? patch.css : row.css;
    database.prepare('UPDATE components SET name=?, source=?, compiled=?, css=?, updated_at=? WHERE id=?')
      .run(nextName, nextSource, nextCompiled, nextCss, ts, id);
    touchDocument(row.document_id, ts);
    emitChanged();
    return mapComponent(getComponentRow(id));
  }
  function patchComponent(id, { edits = [], append = {} } = {}) {
    const row = getComponentRow(id);
    if (!row) throw new Error(`Component ${id} not found`);
    const next = { source: row.source || '', css: row.css || '' };
    for (const edit of edits) {
      if (!['source', 'css'].includes(edit.field)) throw new Error(`patchComponent: bad field "${edit.field}"`);
      const src = next[edit.field];
      const count = src.split(edit.find).length - 1;
      if (count === 0) throw new Error(`patchComponent: find not found in ${edit.field}`);
      if (count > 1 && !edit.all) throw new Error(`patchComponent: find matched ${count} times in ${edit.field}; pass all:true`);
      next[edit.field] = edit.all ? src.split(edit.find).join(edit.replace) : src.replace(edit.find, edit.replace);
    }
    if (append.source != null) next.source += append.source;
    if (append.css != null) next.css += append.css;
    return updateComponent(id, { source: next.source, css: next.css });
  }
  function deleteComponent(id) {
    const row = getComponentRow(id);
    if (!row) throw new Error(`Component ${id} not found`);
    database.prepare('DELETE FROM components WHERE id = ?').run(id);
    touchDocument(row.document_id, now());
    emitChanged();
    return { ok: true };
  }
```

- [ ] **Step 4: `applyOps` cases + exports.** Add cases:
```js
        case 'createComponent': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          const c = createComponent({ documentId, name: op.name, source: op.source, css: op.css });
          record(op, c.id);
          return c;
        }
        case 'updateComponent': return updateComponent(targetId(op), op.patch || {});
        case 'patchComponent': return patchComponent(targetId(op), { edits: op.edits, append: op.append });
        case 'deleteComponent': return deleteComponent(targetId(op));
```
Export `listComponents, createComponent, updateComponent, patchComponent, deleteComponent`.

- [ ] **Step 5: `list_components` MCP read tool** in `mcp.js` (near `get_tree`):
```js
  server.registerTool(
    'list_components',
    { description: 'List reusable React components for a document. Defaults to the first document.',
      inputSchema: { documentId: z.number().int().optional() } },
    textTool(async ({ documentId }) => db.listComponents(documentId ?? firstDocumentId(db)))
  );
```
Add the four component ops to the `apply` op-kinds description.

- [ ] **Step 6: Run to verify it passes** → `npx vitest run electron/__tests__/components.test.js` PASS.

- [ ] **Step 7: Commit**
```bash
git add apps/desktop/electron/db.js apps/desktop/electron/mcp.js apps/desktop/electron/__tests__/components.test.js
git commit -m "feat(mcp): reusable React components CRUD"
```

---

### Task 5: Document shared assets + snapshot fidelity (Track S)

**Files:**
- Modify: `apps/desktop/electron/db.js` — `getDocumentAssets/setDocumentAssets`; extend `buildSnapshot` (`:717`) + `restoreVersion` (`:788`); `applyOps` case; exports
- Modify: `apps/desktop/electron/mcp.js` — `get_document_assets` read tool; op text
- Test: `apps/desktop/electron/__tests__/documentAssets.test.js`

**Interfaces:**
- Produces: `getDocumentAssets(documentId) → {css, js}` (defaults empty); `setDocumentAssets({documentId, css?, js?})`; op `setDocumentAssets`. Snapshots include `contents.source/compiled`, `components`, and `document_assets`; restore rebuilds them.

- [ ] **Step 1: Failing test**

Create `apps/desktop/electron/__tests__/documentAssets.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

function doc(db) {
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
  ]);
  return refs.d;
}

test('document assets default empty and round-trip', () => {
  const db = makeDb();
  const d = doc(db);
  expect(db.getDocumentAssets(d)).toEqual({ css: '', js: '' });
  db.applyOps([{ op: 'setDocumentAssets', documentId: d, css: ':root{--g:1}', js: 'window.x=1' }]);
  expect(db.getDocumentAssets(d)).toEqual({ css: ':root{--g:1}', js: 'window.x=1' });
});

test('snapshot restore preserves components and assets', () => {
  const db = makeDb();
  const d = doc(db);
  db.applyOps([
    { op: 'setDocumentAssets', documentId: d, css: 'a{}', js: '' },
    { op: 'createComponent', documentId: d, name: 'B', source: 'export default () => <i/>' },
    { op: 'addVersion', documentId: d, summary: 'v1' },
  ]);
  db.applyOps([{ op: 'setDocumentAssets', documentId: d, css: 'CHANGED', js: '' }]);
  const versions = db.listVersions(d);
  db.restoreVersion(versions[versions.length - 1].id);
  expect(db.getDocumentAssets(d).css).toBe('a{}');
  expect(db.listComponents(d).map((c) => c.name)).toContain('B');
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement asset accessors** in `db.js`:
```js
  function getDocumentAssets(documentId) {
    const r = database.prepare('SELECT css, js FROM document_assets WHERE document_id = ?').get(documentId);
    return r ? { css: r.css || '', js: r.js || '' } : { css: '', js: '' };
  }
  function setDocumentAssets({ documentId, css, js } = {}) {
    if (!documentId) throw new Error('setDocumentAssets: documentId is required');
    const cur = getDocumentAssets(documentId);
    const ts = now();
    database.prepare(
      `INSERT INTO document_assets (document_id, css, js, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(document_id) DO UPDATE SET css=excluded.css, js=excluded.js, updated_at=excluded.updated_at`
    ).run(documentId, css != null ? css : cur.css, js != null ? js : cur.js, ts);
    touchDocument(documentId, ts);
    emitChanged();
    return getDocumentAssets(documentId);
  }
```

- [ ] **Step 4: Extend `buildSnapshot`** to also capture `source/compiled` per content row, all components, and assets. In the `contents` loop include `source/compiled` from the content row; after building `contents`, add:
```js
    const components = database.prepare('SELECT name, source, compiled, css FROM components WHERE document_id = ?').all(documentId);
    const assets = getDocumentAssets(documentId);
    return JSON.stringify({ nodes, contents, components, assets });
```
(Update the per-content capture to `{ html, css, js, source: c.source ?? null, compiled: c.compiled ?? null }`.)

- [ ] **Step 5: Extend `restoreVersion`** — after the node/content rebuild transaction body, and before `touchDocument`, restore components + assets:
```js
      database.prepare('DELETE FROM components WHERE document_id = ?').run(documentId);
      for (const c of (snapshot.components || [])) {
        database.prepare('INSERT INTO components (document_id, name, source, compiled, css, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(documentId, c.name, c.source, c.compiled, c.css || '', ts, ts);
      }
      if (snapshot.assets) {
        database.prepare(
          `INSERT INTO document_assets (document_id, css, js, updated_at) VALUES (?,?,?,?)
           ON CONFLICT(document_id) DO UPDATE SET css=excluded.css, js=excluded.js, updated_at=excluded.updated_at`
        ).run(documentId, snapshot.assets.css || '', snapshot.assets.js || '', ts);
      }
```
Also update content INSERTs in `restoreVersion` to carry `source/compiled` from `snapContents[...]` (add the two columns to both INSERT statements, defaulting null).

- [ ] **Step 6: `applyOps` case + export + MCP tool.** Case:
```js
        case 'setDocumentAssets': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          return setDocumentAssets({ documentId, css: op.css, js: op.js });
        }
```
Export `getDocumentAssets, setDocumentAssets`. Add `get_document_assets` read tool in `mcp.js` mirroring `list_components`.

- [ ] **Step 7: Run to verify it passes** → PASS.

- [ ] **Step 8: Commit**
```bash
git add apps/desktop/electron/db.js apps/desktop/electron/mcp.js apps/desktop/electron/__tests__/documentAssets.test.js
git commit -m "feat(mcp): document shared assets + snapshot/restore fidelity"
```

---

### Task 6: Content-renderer bundle (Track R, parallel)

**Files:**
- Create: `apps/desktop/src/content-renderer/main.tsx` (bundle entry)
- Create: `apps/desktop/src/content-renderer/render.ts` (payload → mount)
- Create: `apps/desktop/content-renderer.html` (Vite entry HTML)
- Modify: `apps/desktop/vite.config.ts` (second rollup input)
- Test: `apps/desktop/src/content-renderer/render.test.ts` (jsdom)

**Interfaces:**
- Consumes: `RenderPayload` (see Global). `window.React` provided by the bundle.
- Produces: a global `window.__easleRender(payload: RenderPayload, mountEl: HTMLElement)` that evals compiled CJS modules with a shared-component resolver and mounts React, or writes raw html/css/js.

- [ ] **Step 1: Failing test (jsdom)**

Create `apps/desktop/src/content-renderer/render.test.ts`. Add `// @vitest-environment jsdom` at the top and `jsdom` devDep (`npm i -D jsdom` in apps/desktop). Test that a compiled component mounts:
```ts
// @vitest-environment jsdom
import { test, expect } from 'vitest';
import React from 'react';
import { renderPayload } from './render';

test('mounts a compiled react component', () => {
  const compiled = "module.exports.default = () => React.createElement('div', {id:'ok'}, 'hi')";
  const el = document.createElement('div');
  renderPayload({ mode: 'react', compiled, components: {}, assets: { css: '', js: '' } }, el, React);
  expect(el.querySelector('#ok')?.textContent).toBe('hi');
});

test('raw mode writes html', () => {
  const el = document.createElement('div');
  renderPayload({ mode: 'raw', assets: { css: '', js: '' }, raw: { html: '<p>x</p>', css: '', js: '' } }, el, React);
  expect(el.querySelector('p')?.textContent).toBe('x');
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `render.ts`.** Eval compiled CJS in a function scope with `React`, `require` (resolving sibling components by name), and `module`/`exports`:
```ts
import type { Root } from 'react-dom/client';

export interface RenderPayload {
  mode: 'react' | 'raw';
  compiled?: string;
  components?: Record<string, string>;
  assets: { css: string; js: string };
  raw?: { html: string; css: string; js: string };
}

function evalModule(code: string, React: any, resolve: (name: string) => any) {
  const module = { exports: {} as any };
  // components are referenced as require('./ComponentName') or a global registry.
  const require = (name: string) => {
    if (name === 'react') return React;
    const clean = name.replace(/^\.\//, '');
    const c = resolve(clean);
    if (!c) throw new Error(`unknown component: ${name}`);
    return { default: c, __esModule: true };
  };
  // eslint-disable-next-line no-new-func
  new Function('React', 'module', 'exports', 'require', code)(React, module, module.exports, require);
  return module.exports.default || module.exports;
}

export function renderPayload(payload: RenderPayload, mountEl: HTMLElement, React: any, ReactDOM?: { createRoot: (el: Element) => Root }) {
  // shared css/js first (blank by default)
  if (payload.assets.css) { const s = document.createElement('style'); s.textContent = payload.assets.css; document.head.appendChild(s); }
  if (payload.assets.js) { const j = document.createElement('script'); j.textContent = payload.assets.js; document.body.appendChild(j); }

  if (payload.mode === 'raw' && payload.raw) {
    if (payload.raw.css) { const s = document.createElement('style'); s.textContent = payload.raw.css; document.head.appendChild(s); }
    mountEl.innerHTML = payload.raw.html;
    if (payload.raw.js) { const j = document.createElement('script'); j.textContent = payload.raw.js; document.body.appendChild(j); }
    return;
  }

  const registry: Record<string, any> = {};
  const resolve = (name: string) => registry[name];
  for (const [name, code] of Object.entries(payload.components || {})) {
    registry[name] = evalModule(code, React, resolve); // components may reference earlier ones
  }
  const Component = evalModule(payload.compiled || 'module.exports.default = () => null', React, resolve);
  if (ReactDOM) ReactDOM.createRoot(mountEl).render(React.createElement(Component));
  else mountEl.appendChild(React.createElement ? document.createTextNode('') : document.createTextNode(''));
}
```
(For the jsdom test, `ReactDOM` is omitted; add a synchronous fallback: when `ReactDOM` is absent, render via `React`+`react-dom/server`? Simpler: import `react-dom/client` inside `main.tsx` only. For the unit test, mount using `react-dom/client` too — pass it in. Adjust the test to import `createRoot` from `react-dom/client` and pass it; wrap the assertion in `act`/`flushSync`.)

- [ ] **Step 4: Implement `main.tsx`** (bundle entry): imports React + ReactDOM, sets `window.React`, listens for a `postMessage` `{type:'easle:render', payload}` and calls `renderPayload(payload, document.getElementById('root')!, React, ReactDOM)`.

- [ ] **Step 5: Vite second input.** In `vite.config.ts` set `build.rollupOptions.input` to `{ main: 'index.html', contentRenderer: 'content-renderer.html' }`. `content-renderer.html` loads `src/content-renderer/main.tsx` and has `<div id="root"></div>`.

- [ ] **Step 6: Run to verify it passes** → `npx vitest run src/content-renderer/render.test.ts` PASS. Run `npm run build --workspace apps/desktop` — both entries build.

- [ ] **Step 7: Commit**
```bash
git add apps/desktop/src/content-renderer apps/desktop/content-renderer.html apps/desktop/vite.config.ts apps/desktop/package.json package-lock.json
git commit -m "feat(renderer): standalone react content-renderer bundle"
```

---

### Task 7: `ContentFrame` renders react vs legacy (Track R)

**Files:**
- Modify: `apps/desktop/src/canvas/ContentFrame.tsx`
- Modify: `apps/desktop/src/store/types.ts` (add `source?`, `compiled?` to `Content`)
- Test: `apps/desktop/src/canvas/ContentFrame.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `Content` now carries optional `source`/`compiled`; shared assets passed as a prop `assets?: {css,js}` and `components?: Record<string,string>` (compiled) from the store.
- Produces: iframe whose `srcDoc` loads the built content-renderer bundle and posts a `RenderPayload`; legacy nodes (`compiled == null`) use `mode:'raw'`.

- [ ] **Step 1: Extend `Content` type** in `types.ts`:
```ts
export interface Content { html: string; css: string; js: string; source?: string | null; compiled?: string | null; }
```

- [ ] **Step 2: Failing test** — render `ContentFrame` for a legacy node and assert the iframe `srcDoc` contains the raw html; for a react node assert it references the renderer bundle and embeds the compiled payload. (Shallow: assert on the computed `srcDoc` string via a small exported `buildSrcDoc(payload, bundleUrl)` helper — unit-test that helper rather than the iframe.)

- [ ] **Step 3: Implement `buildSrcDoc`** — a pure function returning HTML that loads the bundle (`<script type="module" src="${bundleUrl}">`) and, on `DOMContentLoaded`, posts the payload to itself (`window.postMessage({type:'easle:render', payload}, '*')`), with the payload JSON-embedded. Keep the sandbox: iframe stays `sandbox="allow-scripts"`. The bundle URL resolves to the built `content-renderer` asset (dev: Vite dev server path; prod: `dist/content-renderer.html`'s JS).

- [ ] **Step 4: Branch in `ContentFrame`** — build a `RenderPayload` from `content` + `assets`/`components` props; `mode = content.compiled ? 'react' : 'raw'`; feed `buildSrcDoc` into the iframe `srcDoc`.

- [ ] **Step 5: Thread assets/components through the store** — `store.ts` `getTree` load also fetches `getDocumentAssets` + `listComponents` (compiled map) and passes them to `NodeView`→`ContentFrame`. (Small change in `store.ts:188` load path + `NodeView.tsx:94`.)

- [ ] **Step 6: Run tests + build** → PASS; `npm run build` OK.

- [ ] **Step 7: Commit**
```bash
git add apps/desktop/src/canvas/ContentFrame.tsx apps/desktop/src/canvas/ContentFrame.test.tsx apps/desktop/src/store/types.ts apps/desktop/src/store/store.ts apps/desktop/src/canvas/NodeView.tsx
git commit -m "feat(renderer): ContentFrame renders react-source vs legacy content"
```

---

### Task 8: Docs + end-to-end contract update (Track S, after merge)

**Files:**
- Modify: `CONTRACT.md`, `DESIGN.md` §7, `plugins/easle/skills/design-review-loop/SKILL.md`
- Test: `apps/desktop/electron/__tests__/e2e-react.test.js`

- [ ] **Step 1: End-to-end DB test** — in one `applyOps` batch: create project/doc, `setDocumentAssets`, `createComponent Button`, `createNode` content whose `source` references `Button` via `require('./Button')`, `addVersion`. Assert `getTree({includeContent:true})` returns the node's `compiled`, `listComponents` returns Button, `getDocumentAssets` returns the css. Then `restoreVersion` and re-assert.

- [ ] **Step 2: Run** → PASS.

- [ ] **Step 3: Update docs** — CONTRACT.md op catalogue (`createComponent/updateComponent/patchComponent/deleteComponent/setDocumentAssets`, `setContent {source}`, `list_components`, `get_document_assets`); DESIGN §7 (React path + compile-on-write + sandbox unchanged); SKILL.md (author with components, define shared styles once, icons as shared js).

- [ ] **Step 4: Commit**
```bash
git add CONTRACT.md DESIGN.md plugins/easle/skills/design-review-loop/SKILL.md apps/desktop/electron/__tests__/e2e-react.test.js
git commit -m "docs+test: react component system contract + e2e"
```

---

## Self-Review

- **Spec coverage:** 2.1 schema→Task 1; 2.2 compile→Task 2; 2.3 renderer→Tasks 6–7; 2.4 assets→Task 5; 2.5 MCP surface→Tasks 3,4,5,8; 2.6 migration→Tasks 1,3 (legacy `Raw` path) + Task 5 (snapshot). Covered.
- **Placeholder scan:** Task 6 Step 3 and Task 7 Steps 2–5 describe `renderPayload`/`buildSrcDoc` with concrete code and a named pure helper to unit-test; the ReactDOM wiring note is an explicit implementation instruction, not a TODO. Acceptable but the highest-risk area — flag for careful review at execution.
- **Type consistency:** `RenderPayload`, `compileJsx(...).code`, `Content.source/compiled`, `listComponents`, `getDocumentAssets` names match across tasks and the spec.
- **Open sub-decision (spec):** shared components are code components (JSX), consistent with Tasks 4/6. If the reviewer switches to tree-templates, Tasks 2/4/6 change.
