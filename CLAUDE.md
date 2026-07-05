# GStack Local Tool Readiness

Before large code exploration or code changes in this repository, read `.gstack/tool-readiness.json`.

Use the local tools in this order to reduce tokens:

1. Search project docs and prior decisions with `node src/index.js context search "<query>" --json`.
2. Use `graphify-out/GRAPH_REPORT.md` or `graphify-out/graph.json` for code topology before opening many files.
3. Use `rg` for targeted source search.
4. Validate implementation work with the project scripts and `npx fallow --version` / Fallow-backed gates when relevant.

Important limits:

- Headroom is installed locally at `.gstack/tools/headroom-venv/Scripts/headroom.exe`, but it is `callable_not_routed`.
- Do not claim automatic Headroom token savings unless `.gstack/tools/headroom-venv/Scripts/headroom.exe doctor` shows the proxy is running and the harness is routed.
- Do not run `headroom wrap`, do not register MCP globally, and do not edit Claude/Codex/OpenCode global config unless the user explicitly asks.
- Do not read or modify `.env*` files.

## Research registry (comparações com repos externos)

Before comparing GStack against any external repo/product, read
`.docs/RESEARCH/repository-registry.json`.

- Se o tema envolver **metodologia, skills, onboarding, marketplace, cross-harness ou
  AI-driven dev**, o batch `batch-6-aidd-methodology` (AIDD/lgsreal) é **obrigatório** na
  comparação.
- Repos marcados `archived_reference` entram apenas como **referência histórica**, nunca
  como fonte atual de decisão.
- Documentos de comparação devem partir de `.docs/RESEARCH/comparison-template.md` e
  citar o registry.
- **Uma referência metodológica NUNCA vira dependência runtime do GStack.**

## Knowledge vs Execution

Comandos são classificados em `src/meta/command-layers.js`: **knowledge** (read-only:
`context`, `consult`, `challenge`, `plan`, diagnósticos) nunca editam código-fonte;
**execution** (`task`, `workflow`, `delegate`, `dev`, `verify`, `publish-guard`, …) só
agem via worktree/gates/provenance/rollback. Ver `.docs/ADRS/adr-knowledge-execution-firewall.md`.

