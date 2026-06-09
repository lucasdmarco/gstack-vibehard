# CLI-Anything Hub — Dynamic CLI Download & Execution

## Purpose
Allows AI agents to discover, download, and execute CLI tools dynamically at runtime without requiring the user to manually install them. The Hub maintains a registry of CLI tool definitions and handles version management, dependency resolution, and execution sandboxing.

## Usage
```bash
# Search for a CLI tool
hub search "terraform"

# Install and run a CLI tool on demand
hub run github.com/some-org/some-cli -- --help

# List cached CLI tools
hub list

# Update all cached CLIs
hub update
```

## Meta-Skill Configuration
```json
{
  "hub": {
    "registry": "https://hub.cli-anything.com/registry.json",
    "cache_dir": "~/.cli-hub/cache",
    "max_cache_size": "2GB",
    "default_timeout": 300000
  }
}
```

## How Agents Use It
1. Agent detects need for a CLI tool (e.g., `terraform`, `kubectl`, `gh`)
2. Agent calls `hub search <tool>` to find the tool definition
3. Agent calls `hub run <tool> -- <args>` which downloads (if not cached) and executes
4. Output is streamed back to the agent for processing

## Included in GStack
This skill is pre-installed by `gstack_vibehard install` so every harness (Claude, Codex, Cursor, OpenCode, etc.) can dynamically acquire CLI capabilities without manual setup.

## Claude Code Integration
When using `/effort ultracode`, workflows in `.claude/workflows/` can use `hub run` as a step action to dynamically invoke CLIs during complex multi-step tasks.
