# gstack_vibehard — English Quickstart

> Português: [`.docs/QUICKSTART.md`](./.docs/QUICKSTART.md) · Glossary: [`.docs/GLOSSARY.md`](./.docs/GLOSSARY.md)

A local-first engineering harness where **the deterministic gate decides and the LLM
only advises**. Nothing runs against your machine without consent, and no secret ever
lands in a log, ledger, or external context.

## Requirements

- **Node.js ≥ 18**, **Python 3** (for Quality Gates), **git**.
- Windows: **Git Bash or WSL** to `delegate` to external candidates.

## Core flows

```bash
# Diagnose (read-only, always safe)
node src/index.js doctor --json
node src/index.js doctor --conformance      # enforced/partial/advisory per harness
node src/index.js doctor --candidates       # Codebuff/Freebuff (opt-in, nothing installed)
node src/index.js doctor --ruflo            # optional Ruflo adapter (MCP default-deny)

# Plan & build
node src/index.js start "checkout app" --name shop --dry-run --json   # plan only, nothing written
node src/index.js start "checkout app" --name shop                    # run the pipeline

# Explore without burning tokens (read-only)
node src/index.js context scout "where is payment validated?" --json

# Evidence — no proof, no done
node src/index.js task evidence <taskId> --json
node src/index.js task resume <taskId>

# Delegate safely (opt-in; worktree + verify-after + provenance)
node src/index.js delegate devin    --task "..." --worktree --yes
node src/index.js delegate codebuff  --task "..." --worktree --yes    # advisory external reviewer

# Audit
node src/index.js audit verify        # provenance hash-chain (fails if tampered)
node src/index.js audit events --json  # local event ledger (sanitized, no secrets)
```

## Honesty invariants

- The **deterministic gate** (lint/typecheck/test/build/QG) is the final authority.
- **No harness marketing claims**: instructional harnesses are never labeled enforcement.
- **`no proof, no done`**: only deterministic sources mark a step `proved`.
- **Secrets never leave**: denylists + redaction across scout, ledgers, provenance,
  and delegate context. `.env*` blocks delegation.
- **Nothing remote by default**: `tools install` from a remote source requires confirmation.

## Lite vs Complete

- **Lite**: no global writes; no external harness/candidate installed.
- **Complete**: generates adapters for detected harnesses, with opt-out (`--no-global-mcp`).

See the ADRs in [`.docs/ADRS/`](./.docs/ADRS/) for the key design decisions.
