-- Easle SQLite schema. Owned by the Electron app (apps/desktop).
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- top-level grouping above documents (one install → many projects)
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  -- in-app review loop: idle | awaiting | changes_requested | approved
  review_state TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- idx_documents_project is created in db.js's migrateProjects() (after the
-- project_id column is guaranteed to exist on pre-existing dbs).

-- node tree. type: 'frame' | 'group' | 'content'
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 393,
  h REAL NOT NULL DEFAULT 852,
  z INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_doc ON nodes(document_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

-- 1:1 with type='content'
CREATE TABLE IF NOT EXISTS contents (
  node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  html TEXT NOT NULL DEFAULT '',
  css TEXT NOT NULL DEFAULT '',
  js TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- reusable React components, scoped to a document (author once, use by name)
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

-- document-level shared css/js (blank slate by default)
CREATE TABLE IF NOT EXISTS document_assets (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  css TEXT NOT NULL DEFAULT '',
  js  TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- pinned feedback. node_id null => pinned to canvas; else x/y are relative to the node
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'open',
  parent_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_doc ON notes(document_id);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);

-- immutable snapshots for iteration history
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  author TEXT NOT NULL,
  summary TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(document_id);
