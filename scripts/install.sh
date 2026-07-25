#!/usr/bin/env sh
# Easle installer — downloads the latest prebuilt app from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/dknathalage/easle/main/scripts/install.sh | sh
#
# macOS  -> downloads the .dmg and copies Easle.app into /Applications
# Linux  -> downloads the .AppImage into ~/.local/bin/easle
# Windows-> not supported here; download the .exe from the Releases page.
#
# This installs the APP (which hosts the MCP server). To wire it into Claude Code,
# install the plugin:  /plugin marketplace add dknathalage/easle
#                       /plugin install easle@easle
set -eu

REPO="dknathalage/easle"
API="https://api.github.com/repos/${REPO}/releases/latest"

info() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || err "curl is required."

OS="$(uname -s)"
ARCH="$(uname -m)"

info "Finding the latest Easle release..."
JSON="$(curl -fsSL "$API")" || err "Could not reach GitHub releases API."

# Pick an asset download URL by an extension keyword (and optional arch filter).
# Parses browser_download_url lines without needing jq.
asset_url() {
  ext="$1"; want_arm="${2:-}"
  urls="$(printf '%s\n' "$JSON" | grep -o '"browser_download_url": *"[^"]*'"$ext"'"' | sed 's/.*"\(https[^"]*\)"$/\1/')"
  [ -n "$urls" ] || return 1
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
    MOUNT="$(hdiutil attach "$DMG" -nobrowse -quiet | grep -o '/Volumes/.*' | head -n1)"
    [ -n "$MOUNT" ] || err "Could not mount the .dmg."
    APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "$APP" ] || { hdiutil detach "$MOUNT" -quiet; err "No .app inside the .dmg."; }
    info "Installing to /Applications (may prompt for your password)..."
    DEST="/Applications/$(basename "$APP")"
    rm -rf "$DEST" 2>/dev/null || sudo rm -rf "$DEST"
    cp -R "$APP" /Applications/ 2>/dev/null || sudo cp -R "$APP" /Applications/
    hdiutil detach "$MOUNT" -quiet || true
    rm -rf "$TMP"
    # Unsigned build: clear the quarantine bit so Gatekeeper allows launch.
    xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
    info "Installed. Launch it:  open -a \"$(basename "$APP" .app)\""
    ;;
  Linux)
    URL="$(asset_url '.AppImage')"
    [ -n "${URL:-}" ] || err "No .AppImage asset found in the latest release."
    DEST_DIR="${HOME}/.local/bin"; mkdir -p "$DEST_DIR"
    DEST="$DEST_DIR/easle"
    info "Downloading $URL"
    curl -fsSL "$URL" -o "$DEST"
    chmod +x "$DEST"
    info "Installed to $DEST"
    case ":$PATH:" in
      *":$DEST_DIR:"*) : ;;
      *) info "Add $DEST_DIR to your PATH, then run:  easle" ;;
    esac
    ;;
  *)
    err "Unsupported OS '$OS'. On Windows, download the .exe from https://github.com/${REPO}/releases/latest"
    ;;
esac

info "Next: install the Claude Code plugin —"
printf '      /plugin marketplace add %s\n      /plugin install easle@easle\n' "$REPO"
