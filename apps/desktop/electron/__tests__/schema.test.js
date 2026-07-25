// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
