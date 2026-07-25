// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
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
