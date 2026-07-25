// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
