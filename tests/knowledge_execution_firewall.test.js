import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "meta", "command-layers.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

// Extrai as chaves do objeto DISPATCH em src/cli/index.js (fonte real dos comandos).
function dispatchCommands() {
  const src = readFileSync(path.join(repoRoot, "src", "cli", "index.js"), "utf-8")
  const start = src.indexOf("const DISPATCH = {")
  assert.ok(start >= 0, "achou o bloco DISPATCH")
  const block = src.slice(start, src.indexOf("\n}", start))
  const cmds = []
  for (const m of block.matchAll(/^\s*"?([a-z0-9-]+)"?:\s*(?:\(|=>|function)/gm)) cmds.push(m[1])
  return cmds.filter((c) => c !== "DISPATCH")
}

test("firewall: KNOWLEDGE e EXECUTION são disjuntos (nenhum comando nas duas)", async () => {
  const { KNOWLEDGE, EXECUTION, NEUTRAL } = await imp()
  const k = new Set(KNOWLEDGE)
  for (const c of EXECUTION) assert.ok(!k.has(c), `'${c}' não pode ser knowledge E execution`)
  for (const c of NEUTRAL) assert.ok(!k.has(c) && !new Set(EXECUTION).has(c), `'${c}' neutral é exclusivo`)
})

test("firewall: comandos explícitos do PRD22 §4.3 caem na camada certa", async () => {
  const { layerOf, isReadOnly } = await imp()
  for (const c of ["context", "consult", "challenge", "plan"]) {
    assert.equal(layerOf(c), "knowledge", `${c} é knowledge/read-only`)
    assert.equal(isReadOnly(c), true, `${c} read-only`)
  }
  for (const c of ["task", "workflow", "delegate", "dev", "verify", "publish-guard"]) {
    assert.equal(layerOf(c), "execution", `${c} é execution/gated`)
    assert.equal(isReadOnly(c), false, `${c} não é read-only`)
  }
})

test("firewall: TODO comando real do DISPATCH está classificado (sem 'unknown')", async () => {
  const { layerOf } = await imp()
  const unknown = dispatchCommands().filter((c) => layerOf(c) === "unknown")
  assert.deepEqual(unknown, [], `comandos não classificados: ${unknown.join(", ")}`)
})
