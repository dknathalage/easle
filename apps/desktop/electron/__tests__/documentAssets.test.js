// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
