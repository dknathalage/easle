const { openDb } = require('../db.js');

// A fresh, empty, in-memory Easle DB per test. openDb runs schema + migrations on
// open, so `:memory:` is fully set up; runSchemaAndSeed is skipped so tests start
// with no documents.
function makeDb() {
  return openDb(':memory:');
}

module.exports = { makeDb };
