#!/bin/bash
# gstack_vibehard Installer — macOS/Linux Launcher
# Usage: ./install.sh [install|doctor|help]

set -e

if ! command -v node &> /dev/null; then
    echo "[gstack_vibehard] Node.js not found."
    echo "[gstack_vibehard] Install with: brew install node"
    exit 1
fi

CMD=${1:-install}

npx @gstack_vibehard/installer "$CMD"

echo "[gstack_vibehard] Done."
