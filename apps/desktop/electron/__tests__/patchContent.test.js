// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
