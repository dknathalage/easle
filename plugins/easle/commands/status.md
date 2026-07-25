---
description: Check whether the Easle app (and its embedded MCP server) is running, and explain how to start or install it if not.
allowed-tools: Bash(curl:*)
---

The Easle desktop app hosts the MCP server on `127.0.0.1:47600`. Check whether it is reachable:

!`curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:47600/health || echo 000`

Interpret the HTTP status above:

- **`200`** — Easle is running and the MCP server is reachable. Tell the user they're good to go and can ask you to design or iterate on a UI.
- **anything else** (e.g. `000` = connection refused) — Easle is **not running**. Give the user these short, actionable steps:
  1. **Launch it:** `open -a Easle` (macOS) · run the `easle` AppImage (Linux) · start Easle from the Start menu (Windows).
  2. **If it isn't installed:** `curl -fsSL https://raw.githubusercontent.com/dknathalage/easle/main/scripts/install.sh | sh` (macOS/Linux), or download the installer from https://github.com/dknathalage/easle/releases/latest.
  3. Then re-run `/easle:status` to confirm.

Keep the reply brief.
