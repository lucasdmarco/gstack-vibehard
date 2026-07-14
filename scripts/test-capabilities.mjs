#!/usr/bin/env node
/**
 * Runner dos E2E de backend (PRD42 S42.0D). Probea o engine (Docker daemon):
 *  - AUSENTE  → reporta `blocked_missing_engine` por capacidade e sai 0 (local honesto —
 *               o backend só se prova em CI com engine). Com `--strict` (release/CI) sai 1.
 *  - PRESENTE → roda os E2E reais em tests/e2e/capabilities/ (node --test), propaga o código.
 *
 * NUNCA converte engine ausente em skip-verde: o estado é explícito e tipado.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CAPABILITIES = ["casdoor", "atomic", "agentmemory", "openhands"]
const strict = process.argv.includes("--strict")

function dockerUp() {
  try { execFileSync("docker", ["info"], { stdio: "ignore", timeout: 15000 }); return true }
  catch { return false }
}

if (!dockerUp()) {
  const blocked = CAPABILITIES.map((c) => ({ capability: c, status: "blocked_missing_engine" }))
  process.stdout.write(JSON.stringify({ engine: "docker", present: false, strict, results: blocked }) + "\n")
  console.error(`capability-e2e: Docker daemon AUSENTE — ${CAPABILITIES.length} backend(s) blocked_missing_engine (não é skip-verde).`)
  console.error(strict ? "  --strict: FALHA (release exige engine)." : "  local: OK honesto — os probes reais rodam em CI (capability-e2e.yml).")
  process.exit(strict ? 1 : 0)
}

const res = spawnSync(process.execPath, ["--test", "tests/e2e/capabilities/"], {
  cwd: ROOT, stdio: "inherit", env: { ...process.env, GSTACK_CAP_E2E: "1" },
})
process.exit(res.status || 0)
