# Phase 1: MCP Authoring Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three MCP authoring papercuts — `moveNode` ignoring position, `get_tree` blowing the token limit, and `setContent` forcing whole-blob rewrites.

**Architecture:** All changes live in the DB layer (`apps/desktop/electron/db.js`) and the MCP tool surface (`apps/desktop/electron/mcp.js`). No schema change. A Vitest harness is added (the repo currently has no tests) and drives the DB layer against an in-memory SQLite database.

**Tech Stack:** Node/CommonJS, better-sqlite3 (in-memory for tests), Vitest, MCP SDK, zod.

## Global Constraints

- DB layer methods are synchronous and CommonJS (`require`/`module.exports`). Match the existing style in `db.js`.
- Booleans convert to SQLite 0/1 at the DB boundary; timestamps are ISO strings via `now()`.
- Every mutating DB method calls `emitChanged()` after commit; inside `applyOps` the per-op `emitChanged` is suppressed and fired once (do not change this).
- This plan must NOT change `db.getTree`'s default behavior for the renderer — only the MCP tool boundary changes.
- Ships independently of Phase 2. Runs in its own git worktree.

---

### Task 0: Vitest harness + in-memory DB helper

**Files:**
- Modify: `apps/desktop/package.json` (add `vitest` devDep + `test` scripts)
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/electron/__tests__/helpers.js`
- Create: `apps/desktop/electron/__tests__/smoke.test.js`

**Interfaces:**
- Produces: `makeDb()` → returns a fresh `openDb(':memory:')` handle (from `db.js`) with schema applied, seeded empty. Used by every later DB test.

- [ ] **Step 1: Add Vitest + scripts**

In `apps/desktop/package.json`, add to `devDependencies`: `"vitest": "^2.1.0"`. Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```
Run: `npm install` from repo root.

- [ ] **Step 2: Vitest config (node environment for electron/)**

Create `apps/desktop/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.js'],
  },
});
```

- [ ] **Step 3: In-memory DB helper**

Create `apps/desktop/electron/__tests__/helpers.js`. `openDb` runs schema + migrations on open, so `:memory:` is fully set up. `runSchemaAndSeed` is skipped so tests start with an empty doc set.
```js
const { openDb } = require('../db.js');

// A fresh, empty, in-memory Easle DB per test. No seed document.
function makeDb() {
  return openDb(':memory:');
}

module.exports = { makeDb };
```

- [ ] **Step 4: Smoke test**

Create `apps/desktop/electron/__tests__/smoke.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

test('empty db has no documents', () => {
  const db = makeDb();
  expect(db.listDocuments()).toEqual([]);
});
```

- [ ] **Step 5: Run and verify pass**

Run: `npm test --workspace apps/desktop`
Expected: PASS (1 test). If `better-sqlite3` fails to load with an ABI/NODE_MODULE_VERSION error, run `npm rebuild better-sqlite3 --workspace apps/desktop` (the repo's `rebuild` script targets Electron; tests need the node ABI). Document this in the commit message.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json apps/desktop/vitest.config.ts apps/desktop/electron/__tests__ package-lock.json
git commit -m "test: add vitest harness with in-memory db helper"
```

---

### Task 1: `moveNode` accepts x/y/w/h

**Files:**
- Modify: `apps/desktop/electron/db.js:1090` (the `moveNode` case in `applyOps`)
- Test: `apps/desktop/electron/__tests__/moveNode.test.js`

**Interfaces:**
- Consumes: `makeDb()` from Task 0; existing `db.applyOps(ops)`.
- Produces: op `moveNode { id|ref, parentId?|parentRef?, pageId?|pageRef?, x?, y?, w?, h?, z? }` now writes x/y/w/h.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/electron/__tests__/moveNode.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

test('moveNode repositions x/y/w/h', () => {
  const db = makeDb();
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
    { op: 'createNode', ref: 'f', documentRef: 'd', type: 'frame', name: 'F', x: 10, y: 10 },
  ]);
  const id = refs.f;
  db.applyOps([{ op: 'moveNode', id, x: 900, y: 80, w: 400, h: 300 }]);
  const n = db.getNode(id);
  expect([n.x, n.y, n.w, n.h]).toEqual([900, 80, 400, 300]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/moveNode.test.js` (cwd `apps/desktop`)
Expected: FAIL — x/y unchanged (still 10,10).

- [ ] **Step 3: Implement — pass geometry through to updateNode**

In `db.js`, the `moveNode` case currently builds `patch` from `parentId`/`z` only. Extend it:
```js
        case 'moveNode': {
          const id = targetId(op);
          const parentId = idOf(op, 'parentId', 'parentRef');
          const pageId = idOf(op, 'pageId', 'pageRef');
          const patch = {};
          if (parentId !== undefined) patch.parentId = parentId;
          if (op.z != null) patch.z = op.z;
          if (op.x != null) patch.x = op.x;
          if (op.y != null) patch.y = op.y;
          if (op.w != null) patch.w = op.w;
          if (op.h != null) patch.h = op.h;
          if (Object.keys(patch).length) updateNode(id, patch);
          if (pageId !== undefined) setNodePage(id, pageId);
          return getNode(id);
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/__tests__/moveNode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/db.js apps/desktop/electron/__tests__/moveNode.test.js
git commit -m "feat(mcp): moveNode repositions x/y/w/h"
```

---

### Task 2: Lean `get_tree` (MCP tool omits content by default)

**Files:**
- Modify: `apps/desktop/electron/db.js` — `getTree` signature (`:358`)
- Modify: `apps/desktop/electron/mcp.js` — `get_tree` tool (`:60-68`)
- Test: `apps/desktop/electron/__tests__/getTree.test.js`

**Interfaces:**
- Consumes: `makeDb()`.
- Produces: `db.getTree(documentId, { includeContent = true } = {})`. When `includeContent` is false, content nodes omit `content` and instead carry `contentBytes: number` (byte length of html+css+js).
- The MCP `get_tree` tool defaults `includeContent:false`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/electron/__tests__/getTree.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

function seedDoc(db) {
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
    { op: 'createNode', ref: 'c', documentRef: 'd', type: 'content', name: 'C',
      content: { html: '<b>hi</b>', css: '.x{}', js: '' } },
  ]);
  return refs;
}

test('getTree includes content by default (renderer path)', () => {
  const db = makeDb();
  const { d } = seedDoc(db);
  const { nodes } = db.getTree(d);
  const c = nodes.find((n) => n.type === 'content');
  expect(c.content.html).toBe('<b>hi</b>');
  expect(c.contentBytes).toBeUndefined();
});

test('getTree omits content when includeContent=false, adds contentBytes', () => {
  const db = makeDb();
  const { d } = seedDoc(db);
  const { nodes } = db.getTree(d, { includeContent: false });
  const c = nodes.find((n) => n.type === 'content');
  expect(c.content).toBeUndefined();
  expect(c.contentBytes).toBe(Buffer.byteLength('<b>hi</b>' + '.x{}' + ''));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/getTree.test.js`
Expected: FAIL — second test throws / `content` still present.

- [ ] **Step 3: Implement — optional content in getTree**

Replace the `getTree` body in `db.js` (`:358`):
```js
  function getTree(documentId, { includeContent = true } = {}) {
    const document = mapDocument(
      database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId)
    );
    if (!document) throw new Error(`Document ${documentId} not found`);

    const rows = database
      .prepare('SELECT * FROM nodes WHERE document_id = ? ORDER BY parent_id ASC, z ASC, id ASC')
      .all(documentId);
    const nodes = rows.map((row) => {
      const node = mapNode(row);
      if (node.type === 'content') {
        const c = mapContent(getContentRow(node.id)) || { html: '', css: '', js: '' };
        if (includeContent) {
          node.content = c;
        } else {
          node.contentBytes = Buffer.byteLength((c.html || '') + (c.css || '') + (c.js || ''));
        }
      }
      return node;
    });
    return { document, nodes };
  }
```

- [ ] **Step 4: Default the MCP tool to lean**

In `mcp.js`, update the `get_tree` registration (`:60`). Add the param and pass `includeContent`:
```js
  server.registerTool(
    'get_tree',
    {
      description:
        'Get the flat node tree for a document. content nodes carry a contentBytes hint; ' +
        'pass includeContent:true to inline html/css/js (large). Fetch a single node\'s content with get_node. Defaults to the first document.',
      inputSchema: {
        documentId: z.number().int().optional(),
        includeContent: z.boolean().optional(),
      },
    },
    textTool(async ({ documentId, includeContent }) =>
      db.getTree(documentId ?? firstDocumentId(db), { includeContent: includeContent === true })
    )
  );
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run electron/__tests__/getTree.test.js`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/db.js apps/desktop/electron/mcp.js apps/desktop/electron/__tests__/getTree.test.js
git commit -m "feat(mcp): lean get_tree — omit content by default, add contentBytes hint"
```

---

### Task 3: `patchContent` op

**Files:**
- Modify: `apps/desktop/electron/db.js` — add `patchContent` fn + `applyOps` case; export it
- Modify: `apps/desktop/electron/mcp.js` — extend the `apply` op catalogue description (`:187`)
- Test: `apps/desktop/electron/__tests__/patchContent.test.js`

**Interfaces:**
- Consumes: `makeDb()`; existing `setContent`, `getContentRow`.
- Produces: op `patchContent { id|ref, edits?:[{field:'html'|'css'|'js', find, replace, all?}], append?:{html?,css?,js?} }`. Literal find/replace; throws if `find` missing or matched more than once unless `all:true`. Reuses `setContent` to write.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/electron/__tests__/patchContent.test.js`:
```js
const { test, expect } = require('vitest');
const { makeDb } = require('./helpers');

function seed(db, html) {
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
    { op: 'createNode', ref: 'c', documentRef: 'd', type: 'content', name: 'C',
      content: { html, css: '', js: '' } },
  ]);
  return refs.c;
}

test('patchContent replaces a unique substring', () => {
  const db = makeDb();
  const id = seed(db, '<h1>Old</h1>');
  db.applyOps([{ op: 'patchContent', id, edits: [{ field: 'html', find: 'Old', replace: 'New' }] }]);
  expect(db.getNode(id).content.html).toBe('<h1>New</h1>');
});

test('patchContent throws when find is absent', () => {
  const db = makeDb();
  const id = seed(db, '<h1>Hi</h1>');
  expect(() =>
    db.applyOps([{ op: 'patchContent', id, edits: [{ field: 'html', find: 'Nope', replace: 'X' }] }])
  ).toThrow(/not found/i);
  expect(db.getNode(id).content.html).toBe('<h1>Hi</h1>'); // rolled back
});

test('patchContent throws on non-unique find unless all:true', () => {
  const db = makeDb();
  const id = seed(db, '<p>a</p><p>a</p>');
  expect(() =>
    db.applyOps([{ op: 'patchContent', id, edits: [{ field: 'html', find: 'a', replace: 'b' }] }])
  ).toThrow(/multiple|unique/i);
  db.applyOps([{ op: 'patchContent', id, edits: [{ field: 'html', find: 'a', replace: 'b', all: true }] }]);
  expect(db.getNode(id).content.html).toBe('<p>b</p><p>b</p>');
});

test('patchContent append concatenates', () => {
  const db = makeDb();
  const id = seed(db, '<h1>Hi</h1>');
  db.applyOps([{ op: 'patchContent', id, append: { html: '<p>more</p>' } }]);
  expect(db.getNode(id).content.html).toBe('<h1>Hi</h1><p>more</p>');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/__tests__/patchContent.test.js`
Expected: FAIL — unknown op "patchContent".

- [ ] **Step 3: Implement `patchContent` (place next to `setContent`, ~`:512`)**

```js
  function patchContent(id, { edits = [], append = {} } = {}) {
    const row = getNodeRow(id);
    if (!row) throw new Error(`Node ${id} not found`);
    if (row.type !== 'content') throw new Error(`Node ${id} is not a content node`);
    const existing = getContentRow(id) || { html: '', css: '', js: '' };
    const next = { html: existing.html || '', css: existing.css || '', js: existing.js || '' };

    for (const edit of edits) {
      const field = edit.field;
      if (!['html', 'css', 'js'].includes(field)) {
        throw new Error(`patchContent: bad field "${field}"`);
      }
      const src = next[field];
      const parts = src.split(edit.find);
      const count = parts.length - 1;
      if (count === 0) throw new Error(`patchContent: find not found in ${field}: ${JSON.stringify(edit.find)}`);
      if (count > 1 && !edit.all) {
        throw new Error(`patchContent: find matched ${count} times in ${field} (not unique); pass all:true to replace all`);
      }
      next[field] = edit.all ? parts.join(edit.replace) : src.replace(edit.find, edit.replace);
    }
    for (const field of ['html', 'css', 'js']) {
      if (append[field] != null) next[field] = next[field] + append[field];
    }
    // reuse setContent's write path (handles updated_at + touchDocument + content upsert)
    return setContent(id, next);
  }
```

- [ ] **Step 4: Wire the `applyOps` case + export**

In the `applyOps` switch (after the `setContent` case, ~`:1087`):
```js
        case 'patchContent': {
          const id = targetId(op);
          return patchContent(id, { edits: op.edits, append: op.append });
        }
```
Add `patchContent,` to the returned object (near `setContent,` ~`:1193`).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run electron/__tests__/patchContent.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/db.js apps/desktop/electron/__tests__/patchContent.test.js
git commit -m "feat(mcp): patchContent op — find/replace + append within content"
```

---

### Task 4: Update the `apply` op catalogue + docs

**Files:**
- Modify: `apps/desktop/electron/mcp.js:187` (op list in the `apply` description)
- Modify: `CONTRACT.md` (`:81` moveNode; `:83`ish op catalogue)
- Modify: `plugins/easle/skills/design-review-loop/SKILL.md` (mention moveNode position + patchContent)

**Interfaces:**
- Consumes: the ops shipped in Tasks 1–3. No test (docs only).

- [ ] **Step 1: mcp.js apply description**

In `mcp.js`, add `patchContent` to the "Op kinds" sentence (`:187`) and note moveNode takes position. Change the op list to include `patchContent` after `setContent`, and append to the description: `'moveNode also accepts x/y/w/h to reposition. patchContent {id|ref, edits:[{field,find,replace,all?}], append?} edits content in place.'`

- [ ] **Step 2: CONTRACT.md**

Update line 81 to `moveNode { id|ref, parentId?|parentRef?, pageId?|pageRef?, x?, y?, w?, h?, z? }`. Add under the patch section:
`patchContent   { id|ref, edits?:[{field:'html'|'css'|'js',find,replace,all?}], append?:{html?,css?,js?} }`.
Add `contentBytes?` to the `Node` shape note (line ~11) as "present on lean get_tree instead of content".

- [ ] **Step 3: SKILL.md**

In `design-review-loop/SKILL.md`, in the editing section (~`:78`), add: "Reposition a frame with `moveNode {id, x, y}`. Tweak content in place with `patchContent {id, edits:[{field:'html', find, replace}]}` instead of resending the whole node."

- [ ] **Step 4: Full test run + commit**

Run: `npm test --workspace apps/desktop` (all Phase 1 tests green).
```bash
git add apps/desktop/electron/mcp.js CONTRACT.md plugins/easle/skills/design-review-loop/SKILL.md
git commit -m "docs: document moveNode position, patchContent, lean get_tree"
```

---

## Self-Review

- **Spec coverage:** 1a→Task 1, 1b→Task 2, 1c→Task 3, docs→Task 4, test infra→Task 0. All Phase-1 spec items covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `getTree(documentId, {includeContent})`, `patchContent(id, {edits, append})`, `moveNode` fields match across tasks and the spec's MCP surface.
