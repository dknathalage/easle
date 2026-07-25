#!/usr/bin/env sh
# Easle installer / updater — downloads the latest prebuilt app from GitHub Releases.
# Re-run this any time to UPDATE to the newest version (it overwrites the old one).
#
#   curl -fsSL https://raw.githubusercontent.com/dknathalage/easle/main/scripts/install.sh | sh
#
# macOS  -> downloads the .dmg and copies Easle.app into /Applications
# Linux  -> downloads the .AppImage into ~/.local/bin/easle  (x86_64 only)
# Windows-> not supported here; download the .exe from the Releases page (see README).
#
# This installs the APP (which hosts the MCP server). To wire it into Claude Code:
#   /plugin marketplace add dknathalage/easle
#   /plugin install easle@easle
set -eu

REPO="dknathalage/easle"
API="https://api.github.com/repos/${REPO}/releases/latest"

info() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl is required."

OS="$(uname -s)"
ARCH="$(uname -m)"

info "Finding the latest Easle release..."
JSON="$(curl -fsSL "$API")" || err "Could not reach the GitHub releases API."

# The release version, e.g. 0.1.1 — used to prefer the current version's assets
# (a release can carry stale files from older builds; never pick those).
TAG="$(printf '%s\n' "$JSON" | grep -o '"tag_name":[^,]*' | head -n1 | sed 's/.*"\(v[^"]*\)".*/\1/')"
VERSION="${TAG#v}"

# Pick an asset download URL by extension keyword, preferring the current version
# and (for .dmg) the requested arch. Parses browser_download_url without jq.
asset_url() {
  ext="$1"; want_arm="${2:-}"
  urls="$(printf '%s\n' "$JSON" | grep -o '"browser_download_url": *"[^"]*'"$ext"'"' | sed 's/.*"\(https[^"]*\)"$/\1/')"
  [ -n "$urls" ] || return 1
  if [ -n "${VERSION:-}" ]; then
    vfiltered="$(printf '%s\n' "$urls" | grep -F -- "-${VERSION}-" || true)"
    [ -n "$vfiltered" ] && urls="$vfiltered"
  fi
  if [ "$want_arm" = "arm64" ]; then
    printf '%s\n' "$urls" | grep -i 'arm64' | head -n1 && return 0
    printf '%s\n' "$urls" | head -n1
  elif [ "$want_arm" = "x64" ]; then
    printf '%s\n' "$urls" | grep -iv 'arm64' | head -n1 && return 0
    printf '%s\n' "$urls" | head -n1
  else
    printf '%s\n' "$urls" | head -n1
  fi
}

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) URL="$(asset_url '.dmg' arm64)" ;;
      *)     URL="$(asset_url '.dmg' x64)" ;;
    esac
    [ -n "${URL:-}" ] || err "No .dmg asset found in the latest release."
    TMP="$(mktemp -d)"; DMG="$TMP/easle.dmg"
    info "Downloading $URL"
    curl -fsSL "$URL" -o "$DMG"
    info "Mounting the disk image..."
    # NOTE: no -quiet — we parse the /Volumes mount point from hdiutil's output.
    MOUNT="$(hdiutil attach "$DMG" -nobrowse -noautoopen | grep -o '/Volumes/.*' | tail -n1)"
    [ -n "$MOUNT" ] || { rm -rf "$TMP"; err "Could not mount the .dmg."; }
    APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "$APP" ] || { hdiutil detach "$MOUNT" -quiet; rm -rf "$TMP"; err "No .app inside the .dmg."; }
    info "Installing to /Applications (replaces any existing copy; may prompt for your password)..."
    DEST="/Applications/$(basename "$APP")"
    rm -rf "$DEST" 2>/dev/null || sudo rm -rf "$DEST"
    cp -R "$APP" /Applications/ 2>/dev/null || sudo cp -R "$APP" /Applications/
    hdiutil detach "$MOUNT" -quiet || true
    rm -rf "$TMP"
    # Unsigned build: clear the quarantine bit so Gatekeeper allows launch.
    xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
    info "Installed Easle ${VERSION}. Launch it:  open -a \"$(basename "$APP" .app)\""
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64) : ;;
      *) err "Only x86_64 Linux installers are published (your arch: $ARCH). Build from source — see the README." ;;
    esac
    URL="$(asset_url '.AppImage')"
    [ -n "${URL:-}" ] || err "No .AppImage asset found (a .deb is also on the Releases page)."
    DEST_DIR="${HOME}/.local/bin"; mkdir -p "$DEST_DIR"
    DEST="$DEST_DIR/easle"
    info "Downloading $URL"
    curl -fsSL "$URL" -o "$DEST"
    chmod +x "$DEST"
    info "Installed Easle ${VERSION} to $DEST  (a .deb is also available on the Releases page)."
    case ":$PATH:" in
      *":$DEST_DIR:"*) info "Run:  easle" ;;
      *) info "Add $DEST_DIR to your PATH, then run:  easle" ;;
    esac
    ;;
  *)
    err "Unsupported OS '$OS'. On Windows, download the .exe from https://github.com/${REPO}/releases/latest"
    ;;
esac

info "To update later, just re-run this script."
info "Next: install the Claude Code plugin —"
printf '      /plugin marketplace add %s\n      /plugin install easle@easle\n' "$REPO"
