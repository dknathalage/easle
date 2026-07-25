// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
