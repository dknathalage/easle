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

Easle is two things you install once: the **desktop app** (which hosts the canvas *and*
the MCP server on `127.0.0.1:47600`) and the **Claude Code plugin** (which wires that
server into Claude and teaches the review loop). You don't build anything.

## 1. Install the app

Download a prebuilt installer for your OS from the
[**Releases**](https://github.com/dknathalage/easle/releases/latest) page
(`.dmg` for macOS, `.exe` for Windows, `.AppImage`/`.deb` for Linux).

On macOS/Linux, one line installs (or **updates** — re-run it any time to get the newest
version; it overwrites the old one):

```bash
curl -fsSL https://raw.githubusercontent.com/dknathalage/easle/main/scripts/install.sh | sh
```

On Windows, download the `.exe` from Releases, or fetch the latest with PowerShell:

```powershell
$u = (irm https://api.github.com/repos/dknathalage/easle/releases/latest).assets |
     ? { $_.name -like '*-x64.exe' } | select -First 1 -ExpandProperty browser_download_url
$o = "$env:TEMP\EasleSetup.exe"; iwr $u -OutFile $o; & $o
```

> The current builds are **unsigned**. On macOS, right-click the app → **Open** the first
> time (or the installer script clears the quarantine flag for you). On Windows, click
> **More info → Run anyway** on the SmartScreen prompt.
>
> **Updating:** re-run the command above (macOS/Linux) or the installer (Windows) — there
> is no in-app auto-update.

Then launch Easle. The app serves a loopback JSON API on `127.0.0.1:47600` with the MCP
server embedded at `/mcp` — **starting the app is all you need**, there's no separate MCP
process. If the app is down, Claude Code simply can't reach the URL.

## 2. Install the Claude Code plugin

This repo doubles as a plugin marketplace that wires up the MCP server **and** teaches
Claude the review loop in one step:

```
/plugin marketplace add dknathalage/easle
/plugin install easle@easle
```

Restart Claude Code. The `easle` MCP server is configured and the `design-review-loop`
skill activates when you ask Claude to design or iterate on a UI. Run `/easle:status`
anytime to check the app is running (and get launch/install steps if not).

<details>
<summary>Alternative — wire the MCP server manually (no plugin)</summary>

Add to your project's `.mcp.json`:

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
</details>

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

## Develop from source

Building the app yourself (contributors only — users should download a release):

```bash
npm install
npm run rebuild --workspace apps/desktop   # match better-sqlite3 to Electron's ABI
npm run dev                                 # Vite + Electron with hot reload
```

Package installers locally with `npm run dist --workspace apps/desktop` (or `task dist`).

Releases are cut **locally** (no CI). Commit with [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `feat!:` …), then from a clean `main`:

```bash
task release              # version + CHANGELOG from commits, build all platforms, publish
task release BUMP=minor   # force the bump level instead of auto-deriving it
```

`task release` preflights (on `main`, clean tree, `main == origin/main`, `gh` authed),
then via `commit-and-tag-version` derives the semver bump from your commits and updates
`CHANGELOG.md`, builds installers for **all platforms** (mac arm64+x64, win x64, linux x64
— `better-sqlite3` prebuilds are fetched per target, so no Wine/Docker needed here), pushes
the release commit + tag, and publishes the GitHub Release with that version's changelog as
the notes. If the build fails it undoes the release commit/tag, so a failed run is a no-op.
