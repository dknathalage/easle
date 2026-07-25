// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
const { makeDb } = require('./helpers');

const BUTTON_SOURCE = 'export default ({label}) => <button>{label}</button>';
const NODE_SOURCE = "import Button from './Button'; export default () => <Button label=\"Go\" />";
const CSS = ':root{--brand:#333}';

// One applyOps batch: project + document (refs), shared assets, a reusable Button
// component, a content node whose `source` references Button via require('./Button')
// (esbuild turns the `import` into a CJS require, resolved in the renderer), + a version.
function seed(db) {
  const { refs } = db.applyOps([
    { op: 'createProject', ref: 'p', name: 'P' },
    { op: 'createDocument', ref: 'd', projectRef: 'p', name: 'D' },
    { op: 'setDocumentAssets', documentRef: 'd', css: CSS },
    { op: 'createComponent', ref: 'btn', documentRef: 'd', name: 'Button', source: BUTTON_SOURCE },
    { op: 'createNode', ref: 'c', documentRef: 'd', type: 'content', name: 'Screen', content: { source: NODE_SOURCE } },
    { op: 'addVersion', documentRef: 'd', summary: 'v1' },
  ]);
  return refs;
}

test('react component system end-to-end: author, assets, component, version', () => {
  const db = makeDb();
  const refs = seed(db);
  const docId = refs.d;

  // content node's compiled JSX is stored and references React.createElement
  const tree = db.getTree(docId, { includeContent: true });
  const node = tree.nodes.find((n) => n.id === refs.c);
  expect(node).toBeTruthy();
  expect(typeof node.content.compiled).toBe('string');
  expect(node.content.compiled.length).toBeGreaterThan(0);
  expect(node.content.compiled).toMatch(/React\.createElement/);

  // reusable Button component compiled and listed
  const components = db.listComponents(docId);
  const button = components.find((c) => c.name === 'Button');
  expect(button).toBeTruthy();
  expect(typeof button.compiled).toBe('string');
  expect(button.compiled.length).toBeGreaterThan(0);

  // shared document css round-trips
  expect(db.getDocumentAssets(docId).css).toBe(CSS);
});

test('restoreVersion brings back shared assets and components', () => {
  const db = makeDb();
  const refs = seed(db);
  const docId = refs.d;

  // mutate the shared css away from the original
  db.applyOps([{ op: 'setDocumentAssets', documentId: docId, css: 'CHANGED' }]);
  expect(db.getDocumentAssets(docId).css).toBe('CHANGED');

  // restore the latest version and confirm the assets + component are back
  const versions = db.listVersions(docId);
  db.restoreVersion(versions[versions.length - 1].id);

  expect(db.getDocumentAssets(docId).css).toBe(CSS);
  expect(db.listComponents(docId).map((c) => c.name)).toContain('Button');
});
