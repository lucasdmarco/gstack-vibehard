#!/bin/sh
# sync_claude_obsidian.sh — Ponte contínua Claude → Obsidian
#
# Uso:
#   ./sync_claude_obsidian.sh [--watch] [--interval <segundos>]
#
# Modos:
#   --watch       (default) executa em loop com polling a cada N segundos
#   --once        executa uma única vez e sai
#   --interval N  intervalo entre varreduras em segundos (default: 30)
#
# Zero-Config:
#   Detecta PYTHON automaticamente (python3 → python → py).
#   Detecta VAULT_DIR em ~/gstack-vault.
#
# Instalação (background service):
#   nohup ./sync_claude_obsidian.sh --watch > /tmp/sync_claude_obsidian.log 2>&1 &
#
# Systemd (Linux):
#   [Unit]
#   Description=Claude → Obsidian Sync
#   [Service]
#   ExecStart=%h/.local/bin/sync_claude_obsidian.sh --watch
#   Restart=always
#   RestartSec=10
#   [Install]
#   WantedBy=default.target

set -e

# ── Detect Python ──
PYTHON=""
for p in python3 python py; do
  if command -v "$p" >/dev/null 2>&1; then
    PYTHON="$p"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "[sync] ERRO: Python nao encontrado. Instale python3."
  exit 1
fi

# ── Paths ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_SCRIPT="${SCRIPT_DIR}/claude_to_obsidian.py"
VAULT_DIR="${HOME}/gstack-vault"
CHATS_DIR="${VAULT_DIR}/chats"
PIDFILE="/tmp/sync_claude_obsidian.pid"
INTERVAL=30
MODE="watch"

# ── Parse args ──
while [ $# -gt 0 ]; do
  case "$1" in
    --once) MODE="once"; shift ;;
    --watch) MODE="watch"; shift ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    *) echo "[sync] Uso: $0 [--watch|--once] [--interval N]"; exit 1 ;;
  esac
done

# ── Ensure vault exists ──
mkdir -p "$CHATS_DIR"

if [ ! -f "$PIPELINE_SCRIPT" ]; then
  echo "[sync] ERRO: claude_to_obsidian.py nao encontrado em $PIPELINE_SCRIPT"
  exit 1
fi

# ── Single run ──
run_sync() {
  "$PYTHON" "$PIPELINE_SCRIPT" --output "$CHATS_DIR" 2>&1 | while IFS= read -r line; do
    echo "[sync] $line"
  done
}

# ── Watch loop ──
watch_loop() {
  echo "[sync] Claude → Obsidian sync iniciado (intervalo: ${INTERVAL}s)"
  echo "[sync] Vault: $VAULT_DIR"
  echo "[sync] PID: $$"

  # Write PID file
  echo "$$" > "$PIDFILE"

  while true; do
    run_sync
    sleep "$INTERVAL"
  done
}

# ── Execute ──
case "$MODE" in
  once)
    run_sync
    echo "[sync] Sync concluido."
    ;;
  watch)
    watch_loop
    ;;
esac
