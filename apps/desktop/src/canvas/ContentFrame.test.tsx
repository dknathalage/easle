// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { buildRenderPayload, buildLegacySrcDoc } from './ContentFrame';

test('buildRenderPayload uses react mode when compiled is present', () => {
  const p = buildRenderPayload(
    { html: '', css: '', js: '', source: 'x', compiled: 'module.exports.default=()=>null' },
    { css: 'a{}', js: 'z' },
    { Button: 'module.exports.default=()=>null' },
  );
  expect(p.mode).toBe('react');
  expect(p.compiled).toContain('module.exports.default');
  expect(p.components).toEqual({ Button: 'module.exports.default=()=>null' });
  expect(p.assets).toEqual({ css: 'a{}', js: 'z' });
});

test('buildRenderPayload falls back to raw mode for legacy content', () => {
  const p = buildRenderPayload(
    { html: '<b>hi</b>', css: '.x{}', js: '', compiled: null },
    { css: '', js: '' },
    {},
  );
  expect(p.mode).toBe('raw');
  expect(p.raw).toEqual({ html: '<b>hi</b>', css: '.x{}', js: '' });
});

test('buildLegacySrcDoc injects shared assets before node css/js', () => {
  const doc = buildLegacySrcDoc(
    { html: '<p>x</p>', css: '.c{}', js: 'A' },
    { css: '.shared{}', js: 'S' },
  );
  expect(doc).toContain('.shared{}.c{}'); // shared css precedes node css
  expect(doc).toContain('<p>x</p>');
  expect(doc.indexOf('S')).toBeLessThan(doc.lastIndexOf('A')); // shared js script before node js
});
