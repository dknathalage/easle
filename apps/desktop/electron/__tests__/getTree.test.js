// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
