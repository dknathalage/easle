# Easle

A local, infinite-canvas design-iteration tool. The **AI authors** designs as interactive HTML/CSS/JS content nodes on an infinite canvas with layers and groups; **you review**, leave pinned notes, and set status; every iteration is **versioned**. An **MCP server embedded in the app** (over HTTP) lets the AI read your notes and push new versions.

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

## Use it with Claude Code

### Option A — install the plugin (recommended)

This repo ships a Claude Code plugin that wires up the MCP server **and** teaches Claude
the review loop in one step:

```
/plugin marketplace add dknathalage/easle
/plugin install easle@easle
```

Then restart Claude Code and **start the Easle app**. That's it — the `easle` MCP server
is configured and the `design-review-loop` skill activates when you ask Claude to design
or iterate on a UI.

### Option B — wire the MCP server manually

Add to your project's `.mcp.json` (a config-trust decision, so you add it):

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

## The review loop

The AI drives everything through one atomic write tool, `apply`, plus read tools
(`get_tree`, `list_notes`, `list_versions`, …) and the in-app **review loop** — the AI
parks in the app and waits for your verdict instead of ending its turn:

1. AI authors a Project → Document → Page → components tree in one `apply(ops)` call, then
   batches an `addVersion` + `requestReview`.
2. The app shows a **review bar**. You leave pinned notes, then press **Submit review** —
   or **Approve & continue** when you're happy.
3. The AI is parked on `wait_for_review`; on submit it reads your open notes, revises via
   `apply`, resolves the notes, adds a version, and requests review again.
4. Repeat until you **Approve & continue**, at which point the AI resumes its broader task.
