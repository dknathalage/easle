import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { renderPayload, type RenderPayload } from './render';

// Expose React so compiled CJS modules that reference the `React` global work.
(window as any).React = React;

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string; payload?: RenderPayload };
  if (!data || data.type !== 'easle:render' || !data.payload) return;
  const root = document.getElementById('root');
  if (!root) return;
  renderPayload(data.payload, root, React, ReactDOM);
});
