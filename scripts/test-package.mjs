#!/usr/bin/env node
/**
 * Package lifecycle E2E (PRD42 S42.0E). NÃO reimplementa: COMPÕE os provadores existentes —
 * `test-pack.mjs` (npm pack → instala .tgz em prefixo isolado → bin --version/--help/doctor/
 * install --audit-only) e `test-e2e-lifecycle.mjs` (pack→install→doctor→create→build→uninstall
 * com HOME isolado + contrato de verdade 18 REAL/0 PLACEBO). Roda os dois em sequência, propaga
 * o env de lifecycle e o primeiro exit não-zero. Cross-platform (sem shell env inline).
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const steps = [
  { name: "tarball smoke (test-pack)", script: "test-pack.mjs", env: {} },
  { name: "lifecycle isolado (test-e2e-lifecycle)", script: "test-e2e-lifecycle.mjs", env: { GSTACK_E2E_LIFECYCLE: "1" } },
]

for (const s of steps) {
  console.log(`\n=== package lifecycle: ${s.name} ===`)
  const res = spawnSync(process.execPath, [join(HERE, s.script)], { stdio: "inherit", env: { ...process.env, ...s.env } })
  if ((res.status || 0) !== 0) {
    console.error(`package lifecycle FALHOU em: ${s.name} (exit ${res.status})`)
    process.exit(res.status || 1)
  }
}
console.log("\npackage lifecycle: OK (tarball smoke + lifecycle isolado).")
