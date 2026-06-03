---
name: workflows
description: Manage long-running processes (dev servers, background services) using bash, nohup, tmux, and port checks. Start, stop, restart, and monitor processes.
---

# Workflows Skill (Codex CLI)

Manage long-running processes — dev servers, backend APIs, background workers — using standard Unix tools. Codex CLI does not have built-in workflow management like Replit, so all process control is done via bash.

## Overview

A workflow is a persistent process (e.g., `npm run dev`, `python api.py`). This skill replaces Replit's `configureWorkflow()` / `restartWorkflow()` / `listWorkflows()` with bash equivalents.

## When to Use

- You need to start a dev server or background service
- You need to restart the application after code changes
- You need to check what processes are running and on which ports
- You need to stop a running process

## When NOT to Use

- One-off commands (run directly in bash)
- Build scripts (run directly in bash)
- Testing (use Codex's test runner)

## Available Patterns

### Pattern 1: Start a Background Process

```bash
# Start and detach, saving PID
nohup npm run dev > .workflows/app.log 2>&1 &
echo $! > .workflows/app.pid

# Wait for port to be ready
echo "Waiting for port 3000..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "Server is ready on port 3000"
    break
  fi
  sleep 1
done
```

### Pattern 2: List Running Processes

```bash
# List all managed processes
echo "=== Running Workflows ==="
for pidfile in .workflows/*.pid; do
  name=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "  $name (PID: $pid) - RUNNING"
  else
    echo "  $name (PID: $pid) - STOPPED"
  fi
done

# Or list by port
echo "=== Processes by Port ==="
lsof -i -P -n | grep LISTEN
```

### Pattern 3: Check Process Status

```bash
# Check specific process
pid=$(cat .workflows/app.pid 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "Process running (PID: $pid)"
  echo "Recent logs:"
  tail -20 .workflows/app.log
else
  echo "Process not running"
fi
```

### Pattern 4: Restart a Process

```bash
# Stop
if [ -f .workflows/app.pid ]; then
  pid=$(cat .workflows/app.pid)
  kill "$pid" 2>/dev/null
  sleep 1
  # Force kill if still alive
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  rm -f .workflows/app.pid
fi

# Start again
nohup npm run dev > .workflows/app.log 2>&1 &
echo $! > .workflows/app.pid

# Wait for it
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then break; fi
  sleep 1
done
echo "Restarted on port 3000"
```

### Pattern 5: Stop a Process

```bash
# Stop by PID file
if [ -f .workflows/app.pid ]; then
  pid=$(cat .workflows/app.pid)
  kill "$pid" 2>/dev/null
  sleep 1
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  rm -f .workflows/app.pid
  echo "Stopped"
else
  echo "No PID file found"
fi

# Or stop by port
kill $(lsof -t -i:3000) 2>/dev/null && echo "Stopped process on port 3000" || echo "Nothing on port 3000"
```

### Pattern 6: View Logs

```bash
# Tail recent logs
tail -50 .workflows/app.log

# Follow logs in real-time
tail -f .workflows/app.log

# Search logs
grep -i error .workflows/app.log
```

## Pattern 7: Using tmux (for complex setups)

For projects with multiple services (frontend + backend + worker):

```bash
# Create a session with multiple panes
tmux new-session -d -s myapp
tmux send-keys -t myapp "npm run dev" Enter

tmux split-window -h -t myapp
tmux send-keys -t myapp "cd backend && npm run dev" Enter

tmux split-window -v -t myapp
tmux send-keys -t myapp "cd worker && npm run worker" Enter

# Attach to see all three
tmux attach -t myapp

# Detach: Ctrl+b, d
# Kill session: tmux kill-session -t myapp
```

## Setup: Create .workflows Directory (one-time)

```bash
mkdir -p .workflows
echo "*.log" >> .workflows/.gitignore
```

This directory stores PID files and logs. Add to `.gitignore` if desired.

## Best Practices

1. **Always save PID files**: `echo $! > .workflows/<name>.pid` — needed to stop/restart later
2. **Always redirect logs**: `nohup ... > .workflows/<name>.log 2>&1` — needed for debugging
3. **Always wait for ports**: After starting, loop until the port responds
4. **Restart after code changes**: Kill the process, start it again
5. **Clean up**: Stop processes when done — orphaned processes accumulate
6. **One process per project**: Usually just the dev server is enough

## Quick Reference

| Action | Command |
|---|---|
| Start | `nohup npm run dev > .workflows/app.log 2>&1 & echo $! > .workflows/app.pid` |
| Stop | `kill $(cat .workflows/app.pid) 2>/dev/null; rm -f .workflows/app.pid` |
| Restart | Kill + wait + start + wait for port |
| Status | `kill -0 $(cat .workflows/app.pid 2>/dev/null) 2>/dev/null && echo "Running" \|\| echo "Stopped"` |
| Logs | `tail -50 .workflows/app.log` |
| List all | `lsof -i -P -n \| grep LISTEN` |
| Kill by port | `kill $(lsof -t -i:3000)` |
