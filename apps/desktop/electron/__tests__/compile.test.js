// test/expect are globals (vitest globals:true); do NOT require('vitest') — it is ESM-only.
const { compileJsx } = require('../compile.js');

test('compiles JSX to JS referencing global React', () => {
  const { code } = compileJsx('export default function App(){ return <div className="a">hi</div> }');
  expect(typeof code).toBe('string');
  expect(code).toMatch(/React\.createElement/);
});

test('throws on invalid JSX', () => {
  expect(() => compileJsx('export default function(){ return <div> }')).toThrow();
});
