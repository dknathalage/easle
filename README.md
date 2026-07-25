# Easle

A local, Figma-style design-iteration tool. The **AI authors** designs as interactive HTML/CSS/JS content nodes on an infinite canvas with layers and groups; **you review**, leave pinned notes, and set status; every iteration is **versioned**. An **MCP server embedded in the app** (over HTTP) lets the AI read your notes and push new versions.

See [`DESIGN.md`](./DESIGN.md) for the original design, [`docs/spec/2026-07-25-easle-design.md`](./docs/spec/2026-07-25-easle-design.md) for the current design, and [`CONTRACT.md`](./CONTRACT.md) for the module interface.

## Layout

```
easle/
  apps/desktop      Electron app: SQLite (owner) + IPC + localhost API + embedded MCP + React renderer
  packages/shared   schema.sql + shared constants
  data/             runtime SQLite db (gitignored)
```

## Run

```bash
npm install
# better-sqlite3 must match Electron's ABI:
npm run rebuild --workspace apps/desktop     # runs @electron/rebuild for better-sqlite3
npm run dev                                   # launches Vite + Electron
```

The app owns the database and serves a loopback JSON API on `127.0.0.1:47600`. The MCP server is **embedded in the app** and exposed over HTTP on that same address at `/mcp`, so **starting the app is all you need** — there is no separate MCP process. If the app is down, Claude Code simply can't reach the URL.

## Wire up the MCP server

Add to your project's `.mcp.json` (this is a config-trust decision, so you add it) — a dogfood copy for this repo is documented here as well:

```json
{
  "mcpServers": {
    "easle": {
      "type": "http",
      "url": "http://127.0.0.1:47600/mcp"
    }
  }
}
```

Then restart Claude Code and **start the Easle app**. The AI drives everything through one atomic write tool, `apply`, plus read tools (`get_tree`, `list_notes`, `list_versions`, …) — the review loop:

1. AI authors a Project → Document → Page → components tree in one `apply(ops)` call, then `apply` an `addVersion`.
2. You review in the app, pin notes, set status.
3. AI `list_notes` (status "open") → revises nodes/content via `apply` → resolves the notes → adds a version.
4. You compare versions, leave more notes. Repeat.
