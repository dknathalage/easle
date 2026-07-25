# Canvas

A local, Figma-style design-iteration tool. The **AI authors** designs as interactive HTML/CSS/JS content nodes on an infinite canvas with layers and groups; **you review**, leave pinned notes, and set status; every iteration is **versioned**. A stdio **MCP server** lets the AI read your notes and push new versions.

See [`DESIGN.md`](./DESIGN.md) for the full design and [`CONTRACT.md`](./CONTRACT.md) for the module interface.

## Layout

```
Canvas/
  apps/desktop      Electron app: SQLite (owner) + IPC + localhost API + React renderer
  packages/shared   schema.sql + shared constants
  packages/mcp      stdio MCP server (proxies the app's localhost API)
  data/             runtime SQLite db (gitignored)
```

## Run

```bash
cd Canvas
npm install
# better-sqlite3 must match Electron's ABI:
npm run rebuild --workspace apps/desktop     # runs @electron/rebuild for better-sqlite3
npm run dev                                   # launches Vite + Electron
```

The app owns the database and serves a loopback JSON API on `127.0.0.1:47600`. The MCP server talks to that API, so **the app must be running** for MCP tools to work.

## Wire up the MCP server

Add to your project's `.mcp.json` (this is a config-trust decision, so you add it):

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["Canvas/packages/mcp/server.js"]
    }
  }
}
```

Then restart Claude Code. With the app open, the AI can call `get_tree`, `create_node`, `set_content`, `list_notes`, `resolve_note`, `add_version`, etc. — the review loop:

1. AI authors nodes/content → `add_version`.
2. You review in the app, pin notes, set status.
3. AI `list_notes({status:'open'})` → revises → `resolve_note` → `add_version`.
4. You compare versions, leave more notes. Repeat.
