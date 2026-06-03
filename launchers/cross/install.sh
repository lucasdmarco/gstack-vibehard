#!/bin/bash
# GStack VibeHard Installer — macOS/Linux Launcher
# Usage: ./install.sh [install|doctor|help]

set -e

if ! command -v node &> /dev/null; then
    echo "[GStack] Node.js not found."
    echo "[GStack] Install with: brew install node"
    exit 1
fi

CMD=${1:-install}

npx @gstack/installer "$CMD"

echo "[GStack] Done."
