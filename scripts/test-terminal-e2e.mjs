#!/usr/bin/env node
// Runner dos Terminal E2E (caixa-preta) — PRD18 Sprint 9. Invoca o node --test
// sobre os fluxos centrais (start/doctor/dev/verify/delegate/policy/scout) e falha
// (exit≠0) se qualquer um quebrar. Usado no CI antes de marcar release pronta.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const glob = "tests/e2e/**/*.e2e.test.js"

console.log(`[terminal-e2e] rodando ${glob} …`)
const r = spawnSync(process.execPath, ["--test", glob], { cwd: repoRoot, stdio: "inherit" })
if (r.status !== 0) {
  console.error("[terminal-e2e] FALHOU — não publique sem os fluxos centrais verdes.")
  process.exit(r.status || 1)
}
console.log("[terminal-e2e] OK — fluxos centrais passam em terminal.")
