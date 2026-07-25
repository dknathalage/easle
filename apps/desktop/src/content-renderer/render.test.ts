// @vitest-environment jsdom
import { test, expect } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderPayload } from './render';

test('mounts a compiled react component', () => {
  const compiled =
    "module.exports.default = () => React.createElement('div', {id:'ok'}, 'hi')";
  const el = document.createElement('div');
  flushSync(() => {
    renderPayload(
      { mode: 'react', compiled, components: {}, assets: { css: '', js: '' } },
      el,
      React,
      { createRoot },
    );
  });
  expect(el.querySelector('#ok')?.textContent).toBe('hi');
});

test('raw mode writes html', () => {
  const el = document.createElement('div');
  renderPayload(
    { mode: 'raw', assets: { css: '', js: '' }, raw: { html: '<p>x</p>', css: '', js: '' } },
    el,
    React,
  );
  expect(el.querySelector('p')?.textContent).toBe('x');
});
