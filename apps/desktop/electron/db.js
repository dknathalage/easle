// Easle DB layer — single source of truth. CommonJS (Electron main).
// Wraps better-sqlite3. All methods synchronous. Booleans converted at this boundary.
// Every mutating method calls emitChanged() after committing.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Schema lives beside this file (vendored — no external workspace package, so
// electron-builder can package the app). fs reads this correctly inside app.asar.
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const now = () => new Date().toISOString();

// ---- row <-> shape mappers -----------------------------------------------

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id === null || row.project_id === undefined ? null : row.project_id,
    reviewState: row.review_state != null ? row.review_state : 'idle',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNode(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    parentId: row.parent_id === null || row.parent_id === undefined ? null : row.parent_id,
    pageId: row.page_id === null || row.page_id === undefined ? null : row.page_id,
    type: row.type,
    name: row.name,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    z: row.z,
    visible: !!row.visible,
    locked: !!row.locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContent(row) {
  if (!row) return null;
  return { html: row.html, css: row.css, js: row.js };
}

function mapNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    nodeId: row.node_id === null || row.node_id === undefined ? null : row.node_id,
    x: row.x,
    y: row.y,
    body: row.body,
    author: row.author,
    status: row.status,
    parentId: row.parent_id === null || row.parent_id === undefined ? null : row.parent_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at === undefined ? null : row.resolved_at,
  };
}

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    n: row.n,
    author: row.author,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

// ---- schema + seed --------------------------------------------------------

function runSchemaAndSeed(db) {
  // Accept either the raw better-sqlite3 handle or the openDb() wrapper (which
  // exposes the handle as `_raw`). main.js passes the wrapper.
  const raw = db && typeof db.exec === 'function' ? db : db._raw;
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  raw.exec(schema);

  const count = raw.prepare('SELECT COUNT(*) AS c FROM documents').get().c;
  if (count > 0) return;

  const ts = now();
  const seed = raw.transaction(() => {
    const projectInfo = raw
      .prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)')
      .run('Demo', ts, ts);
    const projectId = projectInfo.lastInsertRowid;

    const docInfo = raw
      .prepare('INSERT INTO documents (name, project_id, created_at, updated_at) VALUES (?,?,?,?)')
      .run('Demo', projectId, ts, ts);
    const documentId = docInfo.lastInsertRowid;

    // one page for the seed frame to live under
    const pageInfo = raw
      .prepare('INSERT INTO pages (document_id, name, idx, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(documentId, 'Page 1', 0, ts, ts);
    const pageId = pageInfo.lastInsertRowid;

    const frameInfo = raw
      .prepare(
        `INSERT INTO nodes (document_id, parent_id, page_id, type, name, x, y, w, h, z, visible, locked, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(documentId, null, pageId, 'frame', 'Screen 1', 80, 80, 393, 852, 0, 1, 0, ts, ts);
    const frameId = frameInfo.lastInsertRowid;

    const contentInfo = raw
      .prepare(
        `INSERT INTO nodes (document_id, parent_id, type, name, x, y, w, h, z, visible, locked, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(documentId, frameId, 'content', 'Card', 24, 120, 345, 200, 0, 1, 0, ts, ts);
    const contentId = contentInfo.lastInsertRowid;

    const html = `<div class="card"><h2>Welcome to Easle</h2><p>This is a seeded content node. The AI authors designs here as HTML/CSS/JS.</p><button id="cta">Get started</button></div>`;
    const css = `*{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{padding:24px;border-radius:16px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;height:100%;display:flex;flex-direction:column;gap:12px;justify-content:center;box-shadow:0 10px 30px rgba(99,102,241,.3)}
.card h2{font-size:20px;font-weight:700}
.card p{font-size:14px;opacity:.9;line-height:1.5}
.card button{margin-top:8px;align-self:flex-start;padding:10px 18px;border:none;border-radius:10px;background:#fff;color:#6366f1;font-weight:600;cursor:pointer}`;
    const js = `document.getElementById('cta').addEventListener('click',function(){this.textContent='Clicked!';});`;

    raw.prepare(
      'INSERT INTO contents (node_id, html, css, js, updated_at) VALUES (?,?,?,?,?)'
    ).run(contentId, html, css, js, ts);
  });
  seed();
}

// ---- factory --------------------------------------------------------------

function openDb(dbPath, opts = {}) {
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  // Ensure the base schema exists before running migrations. schema.sql is all
  // `CREATE TABLE IF NOT EXISTS`, so this is safe to run every open (and
  // runSchemaAndSeed re-running it is a no-op). Without this, the migrations
  // below (ALTER TABLE nodes/documents) would throw on a brand-new db.
  {
    database.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }

  // -- migration: projects (top-level grouping above documents) ---------------
  (function migrateProjects() {
    database.exec(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    const cols = database.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
    if (!cols.includes('project_id')) {
      database.exec(
        'ALTER TABLE documents ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE'
      );
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id)');
    // Assign any orphan documents (project_id IS NULL) to a default project.
    const orphans = database
      .prepare('SELECT COUNT(*) c FROM documents WHERE project_id IS NULL')
      .get().c;
    if (orphans > 0) {
      const ts = now();
      const info = database
        .prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)')
        .run('Untitled Project', ts, ts);
      database
        .prepare('UPDATE documents SET project_id = ? WHERE project_id IS NULL')
        .run(info.lastInsertRowid);
    }
  })();

  // -- migration: pages (pages that group top-level frames) -------
  (function migratePages() {
    database.exec(`CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      idx INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    const cols = database.prepare('PRAGMA table_info(nodes)').all().map((c) => c.name);
    if (!cols.includes('page_id')) {
      database.exec('ALTER TABLE nodes ADD COLUMN page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL');
    }
    const ts = now();
    for (const d of database.prepare('SELECT id FROM documents').all()) {
      let first = database
        .prepare('SELECT id FROM pages WHERE document_id = ? ORDER BY idx, id LIMIT 1')
        .get(d.id);
      const orphans = database
        .prepare('SELECT COUNT(*) c FROM nodes WHERE document_id = ? AND parent_id IS NULL AND page_id IS NULL')
        .get(d.id).c;
      if (!first && orphans > 0) {
        const info = database
          .prepare('INSERT INTO pages (document_id, name, idx, created_at, updated_at) VALUES (?,?,?,?,?)')
          .run(d.id, 'Page 1', 0, ts, ts);
        first = { id: info.lastInsertRowid };
      }
      if (first) {
        database
          .prepare('UPDATE nodes SET page_id = ? WHERE document_id = ? AND parent_id IS NULL AND page_id IS NULL')
          .run(first.id, d.id);
      }
    }
  })();

  // -- migration: review_state (in-app review loop) --------------------------
  (function migrateReview() {
    const cols = database.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
    if (!cols.includes('review_state')) {
      database.exec("ALTER TABLE documents ADD COLUMN review_state TEXT NOT NULL DEFAULT 'idle'");
    }
  })();

  let onChanged = typeof opts.onChanged === 'function' ? opts.onChanged : () => {};
  const emitChanged = () => {
    try {
      onChanged();
    } catch (_) {
      /* never let a listener crash a mutation */
    }
  };

  // -- internal helpers -----------------------------------------------------

  const getNodeRow = (id) => database.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  const getContentRow = (nodeId) =>
    database.prepare('SELECT * FROM contents WHERE node_id = ?').get(nodeId);
  const touchDocument = (documentId, ts) =>
    database
      .prepare('UPDATE documents SET updated_at = ? WHERE id = ?')
      .run(ts, documentId);

  // -- projects -------------------------------------------------------------

  function listProjects() {
    return database
      .prepare('SELECT * FROM projects ORDER BY id ASC')
      .all()
      .map((row) => {
        const project = mapProject(row);
        project.documentCount = database
          .prepare('SELECT COUNT(*) AS c FROM documents WHERE project_id = ?')
          .get(row.id).c;
        return project;
      });
  }

  function getProject(id) {
    const project = mapProject(
      database.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    );
    if (!project) throw new Error(`Project ${id} not found`);
    const documents = database
      .prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY id ASC')
      .all(id)
      .map(mapDocument);
    return { project, documents };
  }

  function createProject({ name } = {}) {
    const ts = now();
    const info = database
      .prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?,?,?)')
      .run(name != null ? name : 'Untitled Project', ts, ts);
    emitChanged();
    return mapProject(database.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
  }

  function updateProject(id, patch = {}) {
    const row = database.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) throw new Error(`Project ${id} not found`);
    const ts = now();
    if ('name' in patch) {
      database
        .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
        .run(patch.name, ts, id);
    }
    emitChanged();
    return mapProject(database.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  }

  function deleteProject(id) {
    const row = database.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) throw new Error(`Project ${id} not found`);
    // ON DELETE CASCADE removes documents -> pages/nodes/notes/versions.
    database.prepare('DELETE FROM projects WHERE id = ?').run(id);
    emitChanged();
    return { ok: true };
  }

  // -- documents ------------------------------------------------------------

  function listDocuments(filter = {}) {
    const projectId = filter && filter.projectId != null ? filter.projectId : undefined;
    if (projectId !== undefined) {
      return database
        .prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY id ASC')
        .all(projectId)
        .map(mapDocument);
    }
    return database
      .prepare('SELECT * FROM documents ORDER BY id ASC')
      .all()
      .map(mapDocument);
  }

  function createDocument({ projectId, name } = {}) {
    if (projectId == null) throw new Error('createDocument: projectId is required');
    const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const ts = now();
    let documentId;
    const tx = database.transaction(() => {
      const info = database
        .prepare('INSERT INTO documents (name, project_id, created_at, updated_at) VALUES (?,?,?,?)')
        .run(name != null ? name : 'Untitled', projectId, ts, ts);
      documentId = info.lastInsertRowid;
      // every document starts with one page so the canvas has somewhere to draw
      database
        .prepare('INSERT INTO pages (document_id, name, idx, created_at, updated_at) VALUES (?,?,?,?,?)')
        .run(documentId, 'Page 1', 0, ts, ts);
    });
    tx();
    emitChanged();
    return mapDocument(database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId));
  }

  function getTree(documentId) {
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
        node.content = mapContent(getContentRow(node.id)) || { html: '', css: '', js: '' };
      }
      return node;
    });
    return { document, nodes };
  }

  function getNode(id) {
    const row = getNodeRow(id);
    if (!row) return null;
    const node = mapNode(row);
    if (node.type === 'content') {
      node.content = mapContent(getContentRow(node.id)) || { html: '', css: '', js: '' };
    }
    return node;
  }

  // -- node mutations -------------------------------------------------------

  function createNode({ documentId, parentId = null, type, name, x, y, w, h, z, pageId } = {}) {
    if (!documentId) throw new Error('createNode: documentId is required');
    if (!type) throw new Error('createNode: type is required');
    const ts = now();
    const nodeName = name != null ? name : type.charAt(0).toUpperCase() + type.slice(1);
    const px = parentId === undefined ? null : parentId;
    // Top-level nodes belong to a page; default to the document's first page.
    let resolvedPage = null;
    if (px == null) {
      resolvedPage = pageId != null
        ? pageId
        : (database.prepare('SELECT id FROM pages WHERE document_id = ? ORDER BY idx, id LIMIT 1').get(documentId) || {}).id ?? null;
    }

    let newId;
    const tx = database.transaction(() => {
      const info = database
        .prepare(
          `INSERT INTO nodes (document_id, parent_id, page_id, type, name, x, y, w, h, z, visible, locked, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          documentId,
          px,
          resolvedPage,
          type,
          nodeName,
          x != null ? x : 0,
          y != null ? y : 0,
          w != null ? w : 393,
          h != null ? h : 852,
          z != null ? z : 0,
          1,
          0,
          ts,
          ts
        );
      newId = info.lastInsertRowid;
      if (type === 'content') {
        database
          .prepare('INSERT INTO contents (node_id, html, css, js, updated_at) VALUES (?,?,?,?,?)')
          .run(newId, '', '', '', ts);
      }
      touchDocument(documentId, ts);
    });
    tx();
    emitChanged();
    return getNode(newId);
  }

  function updateNode(id, patch = {}) {
    const row = getNodeRow(id);
    if (!row) throw new Error(`Node ${id} not found`);
    const ts = now();
    const allowed = ['name', 'x', 'y', 'w', 'h', 'z', 'visible', 'locked', 'parentId'];
    const sets = [];
    const values = [];
    for (const key of allowed) {
      if (!(key in patch)) continue;
      let value = patch[key];
      let column = key;
      if (key === 'parentId') {
        column = 'parent_id';
        value = value === undefined ? null : value;
      } else if (key === 'visible' || key === 'locked') {
        value = value ? 1 : 0;
      }
      sets.push(`${column} = ?`);
      values.push(value);
    }
    const tx = database.transaction(() => {
      if (sets.length) {
        sets.push('updated_at = ?');
        values.push(ts);
        database.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return getNode(id);
  }

  function deleteNode(id) {
    const row = getNodeRow(id);
    if (!row) throw new Error(`Node ${id} not found`);
    const ts = now();
    const tx = database.transaction(() => {
      // ON DELETE CASCADE removes subtree + contents.
      database.prepare('DELETE FROM nodes WHERE id = ?').run(id);
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return { ok: true };
  }

  function setContent(id, { html, css, js } = {}) {
    const row = getNodeRow(id);
    if (!row) throw new Error(`Node ${id} not found`);
    if (row.type !== 'content')
      throw new Error(`Node ${id} is not a content node`);
    const ts = now();
    const tx = database.transaction(() => {
      let existing = getContentRow(id);
      if (!existing) {
        database
          .prepare('INSERT INTO contents (node_id, html, css, js, updated_at) VALUES (?,?,?,?,?)')
          .run(id, '', '', '', ts);
        existing = getContentRow(id);
      }
      const nextHtml = html != null ? html : existing.html;
      const nextCss = css != null ? css : existing.css;
      const nextJs = js != null ? js : existing.js;
      database
        .prepare('UPDATE contents SET html = ?, css = ?, js = ?, updated_at = ? WHERE node_id = ?')
        .run(nextHtml, nextCss, nextJs, ts, id);
      database.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').run(ts, id);
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return { ok: true };
  }

  // -- grouping -------------------------------------------------------------

  function groupNodes({ nodeIds, name } = {}) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0)
      throw new Error('groupNodes: nodeIds must be a non-empty array');
    const rows = nodeIds.map((nid) => {
      const r = getNodeRow(nid);
      if (!r) throw new Error(`Node ${nid} not found`);
      return r;
    });
    const documentId = rows[0].document_id;
    for (const r of rows) {
      if (r.document_id !== documentId)
        throw new Error('groupNodes: all nodes must belong to the same document');
    }
    // common parent: shared parent_id if all equal, else null (top level)
    const firstParent = rows[0].parent_id === undefined ? null : rows[0].parent_id;
    const commonParent = rows.every(
      (r) => (r.parent_id === undefined ? null : r.parent_id) === firstParent
    )
      ? firstParent
      : null;

    const ts = now();
    // append group after existing z within common parent
    const maxZRow = database
      .prepare(
        commonParent === null
          ? 'SELECT MAX(z) AS mz FROM nodes WHERE document_id = ? AND parent_id IS NULL'
          : 'SELECT MAX(z) AS mz FROM nodes WHERE document_id = ? AND parent_id = ?'
      )
      .get(...(commonParent === null ? [documentId] : [documentId, commonParent]));
    const groupZ = (maxZRow && maxZRow.mz != null ? maxZRow.mz : -1) + 1;

    let groupId;
    const tx = database.transaction(() => {
      const info = database
        .prepare(
          `INSERT INTO nodes (document_id, parent_id, type, name, x, y, w, h, z, visible, locked, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          documentId,
          commonParent,
          'group',
          name != null ? name : 'Group',
          0,
          0,
          393,
          852,
          groupZ,
          1,
          0,
          ts,
          ts
        );
      groupId = info.lastInsertRowid;
      // reparent given nodes under the group, preserving/appending z order
      let z = 0;
      for (const nid of nodeIds) {
        database
          .prepare('UPDATE nodes SET parent_id = ?, z = ?, updated_at = ? WHERE id = ?')
          .run(groupId, z, ts, nid);
        z += 1;
      }
      touchDocument(documentId, ts);
    });
    tx();
    emitChanged();
    return getNode(groupId);
  }

  function ungroup(groupId) {
    const row = getNodeRow(groupId);
    if (!row) throw new Error(`Node ${groupId} not found`);
    if (row.type !== 'group') throw new Error(`Node ${groupId} is not a group`);
    const ts = now();
    const parentId = row.parent_id === undefined ? null : row.parent_id;
    const children = database
      .prepare('SELECT id FROM nodes WHERE parent_id = ? ORDER BY z ASC, id ASC')
      .all(groupId);

    // base z: append children after existing siblings of the group's parent
    const maxZRow = database
      .prepare(
        parentId === null
          ? 'SELECT MAX(z) AS mz FROM nodes WHERE document_id = ? AND parent_id IS NULL'
          : 'SELECT MAX(z) AS mz FROM nodes WHERE document_id = ? AND parent_id = ?'
      )
      .get(...(parentId === null ? [row.document_id] : [row.document_id, parentId]));
    let z = (maxZRow && maxZRow.mz != null ? maxZRow.mz : -1) + 1;

    const tx = database.transaction(() => {
      for (const c of children) {
        database
          .prepare('UPDATE nodes SET parent_id = ?, z = ?, updated_at = ? WHERE id = ?')
          .run(parentId, z, ts, c.id);
        z += 1;
      }
      database.prepare('DELETE FROM nodes WHERE id = ?').run(groupId);
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return { ok: true };
  }

  // -- notes ----------------------------------------------------------------

  function listNotes({ documentId, status } = {}) {
    if (!documentId) throw new Error('listNotes: documentId is required');
    let sql = 'SELECT * FROM notes WHERE document_id = ?';
    const params = [documentId];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY id ASC';
    return database.prepare(sql).all(...params).map(mapNote);
  }

  function createNote({ documentId, nodeId = null, x, y, body, author } = {}) {
    if (!documentId) throw new Error('createNote: documentId is required');
    if (x == null || y == null) throw new Error('createNote: x and y are required');
    if (body == null) throw new Error('createNote: body is required');
    const ts = now();
    let newId;
    const tx = database.transaction(() => {
      const info = database
        .prepare(
          `INSERT INTO notes (document_id, node_id, x, y, body, author, status, parent_id, created_at, resolved_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          documentId,
          nodeId === undefined ? null : nodeId,
          x,
          y,
          body,
          author != null ? author : 'user',
          'open',
          null,
          ts,
          null
        );
      newId = info.lastInsertRowid;
      touchDocument(documentId, ts);
    });
    tx();
    emitChanged();
    return mapNote(database.prepare('SELECT * FROM notes WHERE id = ?').get(newId));
  }

  function updateNote(id, patch = {}) {
    const row = database.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!row) throw new Error(`Note ${id} not found`);
    const ts = now();
    const allowed = {
      body: 'body',
      x: 'x',
      y: 'y',
      status: 'status',
      author: 'author',
      nodeId: 'node_id',
      parentId: 'parent_id',
      resolvedAt: 'resolved_at',
    };
    const sets = [];
    const values = [];
    for (const key of Object.keys(allowed)) {
      if (!(key in patch)) continue;
      sets.push(`${allowed[key]} = ?`);
      values.push(patch[key] === undefined ? null : patch[key]);
    }
    const tx = database.transaction(() => {
      if (sets.length) {
        database.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return mapNote(database.prepare('SELECT * FROM notes WHERE id = ?').get(id));
  }

  function resolveNote(id, { resolution } = {}) {
    const row = database.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!row) throw new Error(`Note ${id} not found`);
    const status = resolution === 'wontfix' ? 'wontfix' : 'resolved';
    const ts = now();
    const tx = database.transaction(() => {
      database
        .prepare('UPDATE notes SET status = ?, resolved_at = ? WHERE id = ?')
        .run(status, ts, id);
      touchDocument(row.document_id, ts);
    });
    tx();
    emitChanged();
    return mapNote(database.prepare('SELECT * FROM notes WHERE id = ?').get(id));
  }

  // -- versions -------------------------------------------------------------

  function buildSnapshot(documentId) {
    const nodeRows = database
      .prepare('SELECT * FROM nodes WHERE document_id = ? ORDER BY id ASC')
      .all(documentId);
    const nodes = nodeRows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      parentId: r.parent_id === undefined ? null : r.parent_id,
      type: r.type,
      name: r.name,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      z: r.z,
      visible: r.visible,
      locked: r.locked,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const contents = {};
    for (const n of nodes) {
      if (n.type === 'content') {
        const c = getContentRow(n.id);
        contents[n.id] = c
          ? { html: c.html, css: c.css, js: c.js }
          : { html: '', css: '', js: '' };
      }
    }
    return JSON.stringify({ nodes, contents });
  }

  function saveVersion({ documentId, summary, author } = {}) {
    if (!documentId) throw new Error('saveVersion: documentId is required');
    const ts = now();
    let newId;
    const tx = database.transaction(() => {
      const maxRow = database
        .prepare('SELECT MAX(n) AS mn FROM versions WHERE document_id = ?')
        .get(documentId);
      const n = (maxRow && maxRow.mn != null ? maxRow.mn : 0) + 1;
      const snapshot = buildSnapshot(documentId);
      const info = database
        .prepare(
          `INSERT INTO versions (document_id, n, author, summary, snapshot, created_at)
           VALUES (?,?,?,?,?,?)`
        )
        .run(documentId, n, author != null ? author : 'user', summary != null ? summary : '', snapshot, ts);
      newId = info.lastInsertRowid;
    });
    tx();
    emitChanged();
    return mapVersion(database.prepare('SELECT * FROM versions WHERE id = ?').get(newId));
  }

  function listVersions(documentId) {
    if (!documentId) throw new Error('listVersions: documentId is required');
    return database
      .prepare('SELECT * FROM versions WHERE document_id = ? ORDER BY n ASC')
      .all(documentId)
      .map(mapVersion);
  }

  function getVersion(id) {
    const row = database.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!row) return null;
    const v = mapVersion(row);
    v.snapshot = row.snapshot;
    return v;
  }

  function restoreVersion(id) {
    const row = database.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!row) throw new Error(`Version ${id} not found`);
    const documentId = row.document_id;
    let snapshot;
    try {
      snapshot = JSON.parse(row.snapshot);
    } catch (e) {
      throw new Error(`Version ${id} snapshot is corrupt`);
    }
    const snapNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const snapContents = snapshot.contents || {};
    const ts = now();

    const tx = database.transaction(() => {
      // remove live nodes (cascade removes contents)
      database.prepare('DELETE FROM nodes WHERE document_id = ?').run(documentId);

      // insert nodes with fresh ids, remapping parent references.
      const idMap = new Map(); // oldId -> newId
      // order by dependency: parents before children. Topologically insert.
      const remaining = snapNodes.slice();
      const inserted = new Set();
      let guard = 0;
      while (remaining.length && guard < snapNodes.length + 5) {
        guard += 1;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const n = remaining[i];
          const oldParent = n.parentId === undefined ? null : n.parentId;
          if (oldParent !== null && !inserted.has(oldParent)) continue; // wait for parent
          const newParent = oldParent === null ? null : idMap.get(oldParent);
          const info = database
            .prepare(
              `INSERT INTO nodes (document_id, parent_id, type, name, x, y, w, h, z, visible, locked, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
            )
            .run(
              documentId,
              newParent === undefined ? null : newParent,
              n.type,
              n.name,
              n.x != null ? n.x : 0,
              n.y != null ? n.y : 0,
              n.w != null ? n.w : 393,
              n.h != null ? n.h : 852,
              n.z != null ? n.z : 0,
              n.visible ? 1 : 0,
              n.locked ? 1 : 0,
              n.createdAt != null ? n.createdAt : ts,
              ts
            );
          const newId = info.lastInsertRowid;
          idMap.set(n.id, newId);
          inserted.add(n.id);
          if (n.type === 'content') {
            const c = snapContents[n.id] || snapContents[String(n.id)] || { html: '', css: '', js: '' };
            database
              .prepare('INSERT INTO contents (node_id, html, css, js, updated_at) VALUES (?,?,?,?,?)')
              .run(newId, c.html || '', c.css || '', c.js || '', ts);
          }
          remaining.splice(i, 1);
        }
      }
      // any orphans (broken parent refs) get reparented to top-level
      for (const n of remaining) {
        const info = database
          .prepare(
            `INSERT INTO nodes (document_id, parent_id, type, name, x, y, w, h, z, visible, locked, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            documentId,
            null,
            n.type,
            n.name,
            n.x != null ? n.x : 0,
            n.y != null ? n.y : 0,
            n.w != null ? n.w : 393,
            n.h != null ? n.h : 852,
            n.z != null ? n.z : 0,
            n.visible ? 1 : 0,
            n.locked ? 1 : 0,
            n.createdAt != null ? n.createdAt : ts,
            ts
          );
        const newId = info.lastInsertRowid;
        if (n.type === 'content') {
          const c = snapContents[n.id] || snapContents[String(n.id)] || { html: '', css: '', js: '' };
          database
            .prepare('INSERT INTO contents (node_id, html, css, js, updated_at) VALUES (?,?,?,?,?)')
            .run(newId, c.html || '', c.css || '', c.js || '', ts);
        }
      }
      touchDocument(documentId, ts);
    });
    tx();
    emitChanged();
    return { ok: true };
  }

  // -- review loop ----------------------------------------------------------
  // documents.review_state: idle | awaiting | changes_requested | approved.
  // The AI sets 'awaiting' (requestReview, usually batched with addVersion), the
  // user sets 'changes_requested'/'approved' from the app, and the AI's
  // wait_for_review MCP tool consumes the signal (back to 'idle') when it wakes.

  const REVIEW_STATES = ['idle', 'awaiting', 'changes_requested', 'approved'];

  function getReviewState(documentId) {
    if (!documentId) throw new Error('getReviewState: documentId is required');
    const row = database.prepare('SELECT review_state FROM documents WHERE id = ?').get(documentId);
    if (!row) throw new Error(`Document ${documentId} not found`);
    return { documentId, state: row.review_state != null ? row.review_state : 'idle' };
  }

  function setReviewState(documentId, state) {
    if (!documentId) throw new Error('setReviewState: documentId is required');
    if (!REVIEW_STATES.includes(state)) throw new Error(`Invalid review state "${state}"`);
    const row = database.prepare('SELECT id FROM documents WHERE id = ?').get(documentId);
    if (!row) throw new Error(`Document ${documentId} not found`);
    database.prepare('UPDATE documents SET review_state = ?, updated_at = ? WHERE id = ?')
      .run(state, now(), documentId);
    emitChanged();
    return { ok: true, state };
  }

  function requestReview(documentId) { return setReviewState(documentId, 'awaiting'); }
  function submitReview(documentId) { return setReviewState(documentId, 'changes_requested'); }
  function approveReview(documentId) { return setReviewState(documentId, 'approved'); }

  // Atomically read the review state and, if the user has acted, reset to 'idle'
  // and report the prior state. Called by wait_for_review when it wakes.
  function consumeReview(documentId) {
    if (!documentId) throw new Error('consumeReview: documentId is required');
    let prior;
    const tx = database.transaction(() => {
      const row = database.prepare('SELECT review_state FROM documents WHERE id = ?').get(documentId);
      if (!row) throw new Error(`Document ${documentId} not found`);
      prior = row.review_state != null ? row.review_state : 'idle';
      if (prior === 'changes_requested' || prior === 'approved') {
        database.prepare('UPDATE documents SET review_state = ?, updated_at = ? WHERE id = ?')
          .run('idle', now(), documentId);
      }
    });
    tx();
    const consumed = prior === 'changes_requested' || prior === 'approved';
    if (consumed) emitChanged();
    return { state: prior, consumed };
  }

  // -- pages ----------------------------------------------------------------

  function listPages(documentId) {
    return database
      .prepare('SELECT * FROM pages WHERE document_id = ? ORDER BY idx, id')
      .all(documentId)
      .map((r) => ({ id: r.id, documentId: r.document_id, name: r.name, idx: r.idx, createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  function createPage({ documentId, name, idx } = {}) {
    if (!documentId) throw new Error('createPage: documentId is required');
    const ts = now();
    const maxIdx = database.prepare('SELECT COALESCE(MAX(idx),-1) m FROM pages WHERE document_id = ?').get(documentId).m;
    const info = database
      .prepare('INSERT INTO pages (document_id, name, idx, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(documentId, name || 'Page', idx != null ? idx : maxIdx + 1, ts, ts);
    emitChanged();
    return listPages(documentId).find((p) => p.id === Number(info.lastInsertRowid));
  }
  function renamePage(id, name) {
    database.prepare('UPDATE pages SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
    emitChanged();
    return { ok: true };
  }
  function deletePage(id) {
    database.prepare('DELETE FROM pages WHERE id = ?').run(id);
    emitChanged();
    return { ok: true };
  }
  function setNodePage(nodeId, pageId) {
    database.prepare('UPDATE nodes SET page_id = ?, updated_at = ? WHERE id = ?').run(pageId, now(), nodeId);
    emitChanged();
    return { ok: true };
  }

  // -- batch apply ----------------------------------------------------------

  // applyOps runs an array of ops in ONE transaction with a shared ref->id map,
  // dispatching each op to the internal helpers above. Any throw rolls back the
  // whole batch. A single emitChanged() fires after commit (one live refresh).
  //
  // Temp refs: a create op may carry `ref: "<string>"`; later ops resolve it via
  // projectRef / documentRef / pageRef / parentRef, or `ref` in an id position
  // (update*/setContent/moveNode/deleteNode accept `ref` as well as `id`).
  function applyOps(ops) {
    if (!Array.isArray(ops)) throw new Error('applyOps: ops must be an array');

    const refs = new Map(); // ref string -> real id
    const resolveRef = (name) => {
      if (!refs.has(name)) throw new Error(`applyOps: unresolved ref "${name}"`);
      return refs.get(name);
    };
    // Resolve an id that may be given as a real id or a `*Ref` string field.
    const idOf = (op, idKey, refKey) => {
      if (op[idKey] != null) return op[idKey];
      if (op[refKey] != null) return resolveRef(op[refKey]);
      return undefined;
    };
    // Resolve the `id | ref` position used by update*/setContent/moveNode/deleteNode.
    const targetId = (op) => {
      if (op.id != null) return op.id;
      if (op.ref != null) return resolveRef(op.ref);
      throw new Error(`applyOps: op "${op.op}" requires id or ref`);
    };
    const record = (op, id) => {
      if (op.ref != null) refs.set(op.ref, id);
    };

    const results = [];

    const dispatch = (op) => {
      if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
        throw new Error('applyOps: each op must be an object with a string "op"');
      }
      switch (op.op) {
        // ---- create ----
        case 'createProject': {
          const p = createProject({ name: op.name });
          record(op, p.id);
          return p;
        }
        case 'createDocument': {
          const projectId = idOf(op, 'projectId', 'projectRef');
          const d = createDocument({ projectId, name: op.name });
          record(op, d.id);
          return d;
        }
        case 'createPage': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          const p = createPage({ documentId, name: op.name, idx: op.idx });
          record(op, p.id);
          return p;
        }
        case 'createNode': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          const parentId = idOf(op, 'parentId', 'parentRef');
          const pageId = idOf(op, 'pageId', 'pageRef');
          const n = createNode({
            documentId,
            parentId: parentId != null ? parentId : null,
            pageId,
            type: op.type,
            name: op.name,
            x: op.x, y: op.y, w: op.w, h: op.h, z: op.z,
          });
          record(op, n.id);
          if (op.type === 'content' && op.content) {
            setContent(n.id, op.content);
          }
          return getNode(n.id);
        }

        // ---- patch ----
        case 'updateProject':
          return updateProject(targetId(op), op.patch || {});
        case 'updateDocument': {
          const id = targetId(op);
          const patch = op.patch || {};
          const row = database.prepare('SELECT * FROM documents WHERE id = ?').get(id);
          if (!row) throw new Error(`Document ${id} not found`);
          const sets = [];
          const values = [];
          if ('name' in patch) { sets.push('name = ?'); values.push(patch.name); }
          if ('projectId' in patch) { sets.push('project_id = ?'); values.push(patch.projectId); }
          if (sets.length) {
            sets.push('updated_at = ?'); values.push(now());
            database.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
          }
          return mapDocument(database.prepare('SELECT * FROM documents WHERE id = ?').get(id));
        }
        case 'updatePage': {
          const id = targetId(op);
          const patch = op.patch || {};
          const row = database.prepare('SELECT * FROM pages WHERE id = ?').get(id);
          if (!row) throw new Error(`Page ${id} not found`);
          const sets = [];
          const values = [];
          if ('name' in patch) { sets.push('name = ?'); values.push(patch.name); }
          if ('idx' in patch) { sets.push('idx = ?'); values.push(patch.idx); }
          if (sets.length) {
            sets.push('updated_at = ?'); values.push(now());
            database.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
          }
          return { ok: true };
        }
        case 'updateNode':
          return updateNode(targetId(op), op.patch || {});
        case 'setContent': {
          const id = targetId(op);
          return setContent(id, { html: op.html, css: op.css, js: op.js });
        }

        // ---- structure / lifecycle ----
        case 'moveNode': {
          const id = targetId(op);
          const parentId = idOf(op, 'parentId', 'parentRef');
          const pageId = idOf(op, 'pageId', 'pageRef');
          const patch = {};
          if (parentId !== undefined) patch.parentId = parentId;
          if (op.z != null) patch.z = op.z;
          if (Object.keys(patch).length) updateNode(id, patch);
          if (pageId !== undefined) setNodePage(id, pageId);
          return getNode(id);
        }
        case 'groupNodes': {
          const nodeIds = (op.nodeIds || []).map((n) =>
            typeof n === 'string' ? resolveRef(n) : n
          );
          const g = groupNodes({ nodeIds, name: op.name });
          record(op, g.id);
          return g;
        }
        case 'ungroup':
          return ungroup(idOf(op, 'groupId', 'groupRef'));
        case 'deleteNode':
          return deleteNode(targetId(op));
        case 'deletePage':
          return deletePage(op.id);
        case 'deleteDocument': {
          const row = database.prepare('SELECT * FROM documents WHERE id = ?').get(op.id);
          if (!row) throw new Error(`Document ${op.id} not found`);
          database.prepare('DELETE FROM documents WHERE id = ?').run(op.id);
          return { ok: true };
        }
        case 'deleteProject':
          return deleteProject(op.id);

        // ---- review ----
        case 'createNote': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          return createNote({
            documentId,
            nodeId: op.nodeId != null ? op.nodeId : null,
            x: op.x, y: op.y, body: op.body,
            author: op.author != null ? op.author : 'ai',
          });
        }
        case 'resolveNote':
          return resolveNote(op.id, { resolution: op.resolution });
        case 'addVersion': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          return saveVersion({ documentId, summary: op.summary, author: 'ai' });
        }
        case 'restoreVersion':
          return restoreVersion(op.id);
        case 'requestReview': {
          const documentId = idOf(op, 'documentId', 'documentRef');
          return requestReview(documentId);
        }

        default:
          throw new Error(`applyOps: unknown op "${op.op}"`);
      }
    };

    // Suppress per-op emitChanged (the internal helpers call it); emit once after.
    const savedOnChanged = onChanged;
    onChanged = () => {};
    const tx = database.transaction(() => {
      for (const op of ops) results.push(dispatch(op));
    });
    try {
      tx();
    } finally {
      onChanged = savedOnChanged;
    }
    emitChanged();

    return { refs: Object.fromEntries(refs), results };
  }

  return {
    setOnChanged(fn) {
      onChanged = typeof fn === 'function' ? fn : () => {};
    },
    // projects
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
    // documents
    listDocuments,
    createDocument,
    getTree,
    getNode,
    // pages
    listPages,
    createPage,
    renamePage,
    deletePage,
    setNodePage,
    // nodes
    createNode,
    updateNode,
    deleteNode,
    setContent,
    groupNodes,
    ungroup,
    // notes
    listNotes,
    createNote,
    updateNote,
    resolveNote,
    // versions
    saveVersion,
    listVersions,
    getVersion,
    restoreVersion,
    // review loop
    getReviewState,
    requestReview,
    submitReview,
    approveReview,
    consumeReview,
    // batch
    applyOps,
    // escape hatch for tests/tools
    _raw: database,
  };
}

module.exports = { openDb, runSchemaAndSeed };
