// test/expect are globals (vitest globals:true) — do not require('vitest') (ESM-only).
const { makeDb } = require('./helpers');

test('empty db has no documents', () => {
  const db = makeDb();
  expect(db.listDocuments()).toEqual([]);
});
