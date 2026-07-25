// Post Tallyo screens into the running Canvas app, decomposed to component level.
// Usage: CANVAS_DOC=1 node post-screens.cjs screens.json
//   screens.json = [{ name, x, y, w?, h?, components: [{ name, h, html }, ...] }]
// Each screen becomes a `frame` node; each component becomes a child `content`
// node stacked vertically inside it. The shared design-system CSS + icons JS are
// attached to every component node.
const fs = require('fs');
const path = require('path');

const API = process.env.CANVAS_API || 'http://127.0.0.1:47600';
const DOC = Number(process.env.CANVAS_DOC || 1);
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'mockups', 'canvas-screen.css'), 'utf8');
// Mockups are pure HTML/CSS — icons are inlined as SVG at post time, no JS attached.
const JS = '';
const ICONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'mockups', 'icons-inline.json'), 'utf8'));

// Expand <span class="ic ..." data-icon="name"></span> to inline SVG so the
// stored mockup is pure HTML/CSS (no runtime JS).
function inlineIcons(html) {
  // Match a data-icon span regardless of attribute order (class/style/etc.),
  // drop the data-icon attribute, keep all other attributes, inject the SVG.
  return String(html).replace(
    /<span\b([^>]*?)\sdata-icon="([A-Za-z0-9_-]+)"([^>]*)>\s*<\/span>/g,
    (m, pre, name, post) => `<span${pre}${post}>${ICONS[name] || ''}</span>`
  );
}

async function api(method, p, body) {
  const r = await fetch(API + p, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${t}`);
  return j;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node post-screens.cjs screens.json');
  const screens = JSON.parse(fs.readFileSync(file, 'utf8'));
  let total = 0;
  for (const s of screens) {
    const w = s.w || 393;
    const comps = s.components || [];
    const frameH = s.h || comps.reduce((sum, c) => sum + (c.h || 60), 0) || 852;
    const frame = await api('POST', '/node', {
      documentId: DOC, type: 'frame', name: s.name, x: s.x, y: s.y, w, h: frameH,
    });
    let y = 0;
    for (const c of comps) {
      const h = c.h || 60;
      const node = await api('POST', '/node', {
        documentId: DOC, parentId: frame.id, type: 'content', name: c.name,
        x: 0, y, w, h,
      });
      await api('PUT', `/node/${node.id}/content`, { html: inlineIcons(c.html), css: CSS, js: JS });
      y += h;
      total++;
    }
    console.log(`frame ${frame.id} · ${s.name} — ${comps.length} components`);
  }
  console.log(`\ndone: ${screens.length} screens, ${total} component nodes`);
}
main().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
