# 🚀 gstack-vibehard — Full guide (English)

> Short landing: [root README](../../README.md) · Português (detalhado): [docs/pt-BR](../pt-BR/README.md)

**What it is:** a **cross-harness control plane and installer** that runs 100% on your machine and gives your AI coding agents (Claude Code, Cursor, OpenCode, Codex) **security/quality gates, cross-session memory and project scaffolding** — with no hidden global writes and with real rollback.

> The CLI command is **`gstack_vibehard`** (underscore). The npm package is `@gstack-vibehard/installer` (hyphen).

## Why

Ever had an agent try `rm -rf`, commit a `.env`, forget yesterday's session, or say "done!" without running tests? gstack-vibehard is a **safety helmet** for those agents. It does not replace Claude/Cursor — it protects, organizes and gives them memory, locally. Cloud integrations (MCP, Composio) are always **opt-in**.

> Honesty first: gstack does not eliminate hallucination — it adds deterministic *gates* (blocks, verification, memory) so an agent mistake doesn't become damage.

## Start safely (5 minutes)

```bash
# 1) See what it does — installs/writes NOTHING:
npx @gstack-vibehard/installer --help

# 2) Create and run an app (LITE by default: writes only ./my-app, nothing global):
npx @gstack-vibehard/installer create my-app
cd my-app && npm install && npm run dev

# 3) (optional) Read-only environment diagnosis:
npx @gstack-vibehard/installer doctor

# 4) (optional) Ask for a single-path recommendation (read-only):
npx @gstack-vibehard/installer consult "I want a SaaS with login and Stripe"

# 5) (optional) See the global impact of integrating, WITHOUT writing:
npx @gstack-vibehard/installer install --audit-only
```

> **Pick one path only:** `start`/`consult` are the recommended track — choose `create` (project) OR `install` (global) as recommended; never stack both without understanding the impact.

## What you get

- **Destructive-command blocking** (`pre_tool_use` hook) — global safety net (`rm -rf /`, pipe-to-remote-shell, etc.).
- **Persistent memory** (chronicle) — each session is saved and restored.
- **Secret scanning** (`diff-hygiene`) + delegation **blocks** tracked `.env` files.
- **Challenge-Response (VFA)**: high-risk actions (global harness config writes, `git push --force`) require registered evidence before the pre-tool hook lets them through (Claude Code/Cursor real hooks; instructional harnesses are honestly `posthoc_audit_only`).
- **Test gate** (opt-in: `GSTACK_TEST_GATE=on`/`block`).
- **Real runtime**: projects from `create` ship a Runtime Manifest — `dev` starts detached services, `stop`/`logs`/`open` manage them.
- **Worktree lifecycle**: `worktree list|diff|accept|discard|cleanup --dry-run` with deterministic states; cleanup only touches gstack-owned worktrees.
- **MCP inventory**: `tools mcp inventory --json` across Claude/Codex/OpenCode/project — secrets redacted by name, duplication detected. Policy: [MCP-CONNECTOR-POLICY](../MCP-CONNECTOR-POLICY.md).
- **Meta-orchestration v2**: executor in worktree + independent verifier + pluggable LLM reviewer (advisory) + deterministic gates. An LLM never approves alone.
- **Output Guard honesty**: default is post-response audit; in-transit redaction is opt-in via `gstack_vibehard proxy` (`proxy status` shows real coverage).
- **Agent Reach (opt-in)**: internet read/search channels with per-channel consent; cookie/login channels never enabled by default.

## Install paths

| Mode | Global writes |
|---|---|
| `create my-app` (lite, default) | none — only `./my-app` |
| `install --project-only` | minimal (no deps/global MCP/vault) |
| `install` (full) | complete, preflight-first with confirmation; global MCP by default with **opt-out** `--no-global-mcp` |

Every global write is backed up (`.bak`) and registered in a manifest — `uninstall` restores it. Preview anything first: `install --audit-only`, `create --dry-run --json`, `uninstall --dry-run`.

## Harness support (honest matrix)

| Level | Harness |
|---|---|
| **Real hooks** (automatic gates) | Claude Code, Cursor, OpenCode (manifest-owned plugins) |
| **Instructional** (best-effort guidance file) | Codex, Gemini, Windsurf, Kiro, Copilot CLI, Droid, Kilo, Kimi |
| **Detection only** | Zed, VS Code |

Instructional harnesses have no hooks API — gstack cannot enforce gates there and says so (`agents doctor --json`).

## Official sources only

- npm: [`@gstack-vibehard/installer`](https://www.npmjs.com/package/@gstack-vibehard/installer)
- GitHub: `lucasdmarco/gstack-vibehard`

Anything else is an unofficial mirror — treat as a malware risk.

## Verify & quality

`npm test` · `npm run test:py` · `npm run lint` · `npm run typecheck:ts` (real TS baseline, `tsc --noEmit`) · `npm run test:pack` · `GSTACK_E2E_SAFE_INSTALL=1 npm run test:e2e`. CI runs the full matrix on **Linux + Windows + macOS**.

## Reset / uninstall

```bash
gstack_vibehard uninstall --dry-run   # plan (what would be restored/removed)
gstack_vibehard uninstall             # rollback via manifest (preserves your edits)
gstack_vibehard install --reinstall   # repair a broken/stacked install
```

Guides (PT-BR): [quickstart](../guides/quickstart.md) · [install paths](../guides/install-paths.md) · [reset & uninstall](../guides/reset-uninstall.md) · [harness matrix](../guides/harness-matrix.md)

License **MIT**. History: [CHANGELOG](../../CHANGELOG.md) · Security policy: [SECURITY](../../SECURITY.md)
