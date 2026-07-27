import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "cli", "index.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function captureLog() {
  const orig = console.log
  let buf = ""
  console.log = (...a) => { buf += a.join(" ") + "\n" }
  return { restore: () => { console.log = orig }, get: () => buf }
}

/**
 * PRD51 S51.4.4 — achados reais: `research`/`pp` existiam no DISPATCH mas nunca
 * apareciam em `COMMANDS` (help array) — "comando no dispatch sem help", exatamente
 * o que a ação #8 pede pro command-lint detectar. `visual --help`/`research --help`
 * só imprimiam a linha curta do registry — o usage MULTI-SUBCOMANDO real de cada um
 * nunca era alcançado.
 */

test("isKnownCommand: 'research' e 'pp' agora têm entrada em COMMANDS (antes: no DISPATCH, ausentes do help)", async () => {
  const { isKnownCommand } = await imp()
  assert.equal(isKnownCommand("research"), true)
  assert.equal(isKnownCommand("pp"), true)
})

test("helpFor('research'): alcança o usage MULTI-SUBCOMANDO real (printResearchUsage), não só a linha curta", async () => {
  const { helpFor } = await imp()
  const cap = captureLog()
  try { await helpFor("research") } finally { cap.restore() }
  const out = cap.get()
  assert.match(out, /research skills audit --path/, "usage detalhado de research alcançado via --help")
  assert.match(out, /research validate/, "subcomando validate documentado")
})

test("helpFor('visual'): alcança o usage MULTI-SUBCOMANDO real (printUsage), não só a linha curta", async () => {
  const { helpFor } = await imp()
  const cap = captureLog()
  try { await helpFor("visual") } finally { cap.restore() }
  const out = cap.get()
  assert.match(out, /visual doctor/, "usage detalhado de visual alcançado via --help")
  assert.match(out, /visual hooks install\|status/, "subcomando hooks documentado")
})

test("helpFor('doctor'): comando SEM DETAILED_HELP continua funcionando (regressão)", async () => {
  const { helpFor } = await imp()
  const cap = captureLog()
  try { await helpFor("doctor") } finally { cap.restore() }
  assert.match(cap.get(), /doctor/)
})

test("DISPATCH e COMMANDS: todo comando do DISPATCH tem entrada em COMMANDS (nenhum 'sem help')", async () => {
  const cliSrc = (await import("node:fs")).readFileSync(mod, "utf-8")
  const dispatchKeys = [...cliSrc.matchAll(/^\s*"?([a-z][\w-]*)"?:\s*\(a[^)]*\)\s*=>/gm)].map((m) => m[1])
  const { isKnownCommand } = await imp()
  const missing = dispatchKeys.filter((k) => !isKnownCommand(k))
  assert.deepEqual(missing, [], `comando(s) no DISPATCH sem entrada em COMMANDS: ${missing.join(", ")}`)
})
