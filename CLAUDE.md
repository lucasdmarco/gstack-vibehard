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

