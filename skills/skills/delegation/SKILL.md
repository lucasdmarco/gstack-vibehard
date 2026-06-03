---
name: delegation
description: Delegate tasks to specialized sub-agents for parallel execution. Use multi-agent mode or terminal multiplexing to run independent tasks concurrently.
---

# Delegation Skill (Codex CLI)

Delegate tasks to specialized sub-agents for autonomous and parallel execution.

## When to Use

- You need to run multiple independent tasks in parallel
- You have a session plan with tasks that don't depend on each other
- A task is complex enough to warrant its own context window

## When NOT to Use

- Simple tasks you can complete directly
- Tasks requiring immediate user interaction
- Read-only operations (use `/view` or grep instead)
- Quick file edits (ask directly)

## How Codex Parallel Execution Works

Codex CLI supports multi-agent execution via:

1. **Experimental Multi-Agent Mode** — Codex spawns sub-agents automatically when you ask for parallel work
2. **Sequential delegation** — Use `/agent` to switch contexts manually
3. **External multiplexing** — Use `tmux` or terminal tabs for true parallel Codex instances

### Enable Multi-Agent Mode

Add to `~/.codex/config.toml` or `.codex/config.toml`:

```toml
[features]
multi_agent = true
```

Then restart Codex.

## Pattern 1: Prompt-Based Parallel Delegation (Recommended)

Ask Codex to spawn sub-agents explicitly in your prompt:

```
Review this PR (branch vs main). Spawn one agent per point,
wait for all of them, and summarize each result.

1. Security issues
2. Code quality
3. Bugs
4. Race conditions
5. Test flakiness
6. Maintainability
```

Codex spawns 6 sub-agents, each with its own context window, and consolidates results.

### Parallel Build from Session Plan

```
I have a session plan with 3 independent tasks.
Execute them in parallel:

1. Set up the database schema in lib/db/schema/
2. Scaffold the React frontend with Vite in src/
3. Write the OpenAPI spec in lib/api-spec/openapi.yaml

Wait for all to complete, then summarize what was done.
```

## Pattern 2: Manual /agent Switching

Use `/agent` to create named agent threads for different concerns:

```bash
# In Codex CLI:
/agent database-setup
# Now in a dedicated context — set up the schema
# When done, switch back:
/agent main

/agent frontend-scaffold
# Scaffold the frontend
/agent main
```

## Pattern 3: Terminal Multiplexing (True Parallel)

For tasks that must truly run simultaneously, use `tmux` or multiple terminal windows:

```bash
# Terminal 1: Database
codex "Create the database schema in lib/db/schema/"

# Terminal 2: Frontend (in a tmux pane)
codex "Scaffold React Vite frontend in src/"

# Terminal 3: API
codex "Write Express API routes in src/api/"
```

## Best Practices

1. **Use session plans**: For 3+ tasks, create a session plan file and reference it
2. **Independent tasks first**: Only parallelize tasks that don't touch the same files
3. **Be explicit in prompts**: Tell Codex exactly what to do — vague prompts waste context
4. **Pass skill context**: Mention relevant skills in your prompt so Codex loads them:
   ```
   Use the database skill and the react-vite skill for these tasks.
   ```
5. **Check results**: Always verify parallel outputs before merging

## Session Plan Template

```markdown
# Session Plan

## T001: Database Schema
- Details: Create Drizzle schema for users, posts, comments
- Skills: database

## T002: Frontend Setup
- Details: Scaffold React Vite app with routing
- Skills: react-vite

## T003: API Routes
- Details: Create Express CRUD routes for all entities
- Skills: external-apis
```

Then prompt Codex:
```
Execute all 3 tasks from the session plan in parallel.
Wait for all to finish, then summarize.
```
