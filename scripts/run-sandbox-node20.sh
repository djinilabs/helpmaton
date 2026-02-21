#!/usr/bin/env bash
# Run Architect sandbox with Node 20 to avoid spawn EBADF on Node 24+.
# Usage: run-sandbox-node20.sh [path-to-sandbox-cli.js]
# If no path given, looks for CLI under cwd (apps/backend) or ../../node_modules.
# Must be run with cwd = apps/backend when path is not provided.
set -e
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NODE20_DIR=
if [[ -d "$NVM_DIR/versions/node" ]]; then
  NODE20_DIR=$(ls "$NVM_DIR/versions/node" 2>/dev/null | grep '^v20\.' | sort -V | tail -1)
fi
if [[ -n "$NODE20_DIR" && -x "$NVM_DIR/versions/node/$NODE20_DIR/bin/node" ]]; then
  export PATH="$NVM_DIR/versions/node/$NODE20_DIR/bin:$PATH"
fi
if [[ -n "$1" && -f "$1" ]]; then
  CLI="$1"
else
  CLI="node_modules/@architect/sandbox/src/cli/cli.js"
  [[ -f "$CLI" ]] || CLI="../../node_modules/@architect/sandbox/src/cli/cli.js"
  if [[ ! -f "$CLI" ]]; then
    echo "Sandbox CLI not found (pass path or run from apps/backend)" >&2
    exit 1
  fi
fi
exec node "$CLI"
