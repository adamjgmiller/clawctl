#!/usr/bin/env bash
set -euo pipefail

# Install clawctl skill into an OpenClaw agent's skills directory.
# Usage:
#   ./install.sh                     # Install locally
#   ./install.sh <agent-id>          # Install on remote agent via clawctl SSH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="skills/clawctl"
DEST_BASE=".openclaw/workspace"

install_local() {
  local dest="$HOME/$DEST_BASE/$SKILL_DIR"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/SKILL.md" "$dest/SKILL.md"
  echo "Installed clawctl skill to $dest/SKILL.md"
}

install_remote() {
  local agent_id="$1"
  local remote_dest="~/$DEST_BASE/$SKILL_DIR"

  # Get agent host from clawctl
  local host
  host=$(clawctl agents info "$agent_id" 2>/dev/null | grep -i 'host' | awk '{print $NF}')
  if [ -z "$host" ]; then
    echo "Error: could not resolve host for agent '$agent_id'" >&2
    exit 1
  fi

  echo "Installing clawctl skill on $agent_id ($host)..."
  ssh "$host" "mkdir -p $remote_dest"
  scp "$SCRIPT_DIR/SKILL.md" "$host:$remote_dest/SKILL.md"
  echo "Installed clawctl skill on $agent_id at $remote_dest/SKILL.md"
}

if [ $# -eq 0 ]; then
  install_local
else
  install_remote "$1"
fi
