#!/bin/sh
# Openship installer — https://get.openship.io
#
#   curl -fsSL https://get.openship.io | sh
#
# Installs the Openship CLI. Then `openship up` runs Openship locally (API +
# dashboard), or `openship install` fetches the desktop app. Bun is the runtime;
# this script installs it for you if it's missing (no Node or npm needed).
#
# Env overrides:
#   OPENSHIP_VERSION=0.1.9   pin a specific CLI version (default: latest)
set -eu

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
err()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; }

command -v curl >/dev/null 2>&1 || { err "curl is required"; exit 1; }

# 1. Ensure Bun (the runtime). Installs to ~/.bun by default; no Node/npm.
if ! command -v bun >/dev/null 2>&1; then
  info "Installing the Bun runtime…"
  curl -fsSL https://bun.sh/install | bash
  BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export BUN_INSTALL
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

command -v bun >/dev/null 2>&1 || {
  err "Bun install finished but 'bun' is not on PATH. Open a new shell and re-run."
  exit 1
}

# 2. Install the Openship CLI globally (fetched from the registry by Bun —
#    the npm CLI itself is never invoked).
PKG="openship"
[ -n "${OPENSHIP_VERSION:-}" ] && PKG="openship@${OPENSHIP_VERSION}"
info "Installing the Openship CLI (${PKG})…"
bun add -g "$PKG"

BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"

# 3. Bun-only fallback. The published CLI carries a Node shebang
#    (#!/usr/bin/env node), so on a box with no Node the global shim can't
#    launch. Point it at a launcher that runs the CLI under Bun instead (Bun
#    executes the Node-target bundle fine) — so `openship` works Node-free.
if ! command -v node >/dev/null 2>&1; then
  BUN_PATH="$(command -v bun)"
  CLI_JS="${BUN_INSTALL:-$HOME/.bun}/install/global/node_modules/openship/dist/index.js"
  if [ -n "$BUN_PATH" ] && [ -f "$CLI_JS" ]; then
    info "Node not found — wiring 'openship' to run under Bun."
    printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$BUN_PATH" "$CLI_JS" > "$BUN_BIN/openship"
    chmod +x "$BUN_BIN/openship"
  fi
fi

# 4. Next steps.
cat <<EOF

$(printf '\033[32m✔\033[0m') Openship installed.

  openship up         # run Openship locally (API + dashboard)
  openship install    # or install the desktop app
  openship --help     # all commands

If 'openship' isn't found, add Bun's global bin to your PATH:
  export PATH="${BUN_BIN}:\$PATH"
EOF
