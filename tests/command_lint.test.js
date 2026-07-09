import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("ALL_CLI_COMMANDS: união do firewall, ordenada e sem duplicata", async () => {
  const { ALL_CLI_COMMANDS } = await imp("src/meta/command-lint.js")
  const { layerOf } = await imp("src/meta/command-layers.js")
  assert.ok(ALL_CLI_COMMANDS.includes("start"))
  assert.ok(ALL_CLI_COMMANDS.includes("skills"))
  assert.ok(ALL_CLI_COMMANDS.includes("research"))
  assert.equal(new Set(ALL_CLI_COMMANDS).size, ALL_CLI_COMMANDS.length, "sem duplicata")
  for (const c of ALL_CLI_COMMANDS) assert.notEqual(layerOf(c), "unknown")
})

test("citedCommands + lintCommands: detecta comando inexistente", async () => {
  const { citedCommands, lintCommands } = await imp("src/meta/command-lint.js")
  const text = "Rode `gstack_vibehard start` e `gstack_vibehard fakecmd`. Veja `node src/index.js proof`."
  const cited = citedCommands(text)
  assert.deepEqual(cited, ["fakecmd", "proof", "start"])
  assert.deepEqual(lintCommands(text), ["fakecmd"], "só o inexistente")
})

test("commandParity: comandos citados só num dos docs", async () => {
  const { commandParity } = await imp("src/meta/command-lint.js")
  const p = commandParity("gstack_vibehard start\ngstack_vibehard proof", "gstack_vibehard start\ngstack_vibehard dev")
  assert.deepEqual(p.onlyInFirst, ["proof"])
  assert.deepEqual(p.onlyInSecond, ["dev"])
})

test("runCommandLint: ok exige zero comando inexistente; parityOk reportado à parte", async () => {
  const { runCommandLint } = await imp("src/meta/command-lint.js")
  const bad = runCommandLint({ docs: [{ name: "a", text: "gstack_vibehard ghost" }, { name: "b", text: "gstack_vibehard start" }] })
  assert.equal(bad.ok, false, "ghost não existe")
  assert.equal(bad.perFile[0].unknown[0], "ghost")

  const good = runCommandLint({ docs: [{ name: "a", text: "gstack_vibehard start" }, { name: "b", text: "gstack_vibehard start" }] })
  assert.equal(good.ok, true)
  assert.equal(good.parityOk, true)
})

test("READMEs reais: nenhum comando inexistente citado (o GATE de CI)", async () => {
  const { runCommandLint } = await imp("src/meta/command-lint.js")
  const docs = ["README.md", "README.en.md"].map((f) => ({ name: f, text: readFileSync(path.join(repoRoot, f), "utf-8") }))
  const r = runCommandLint({ docs })
  for (const f of r.perFile) assert.deepEqual(f.unknown, [], `${f.name} cita comando inexistente: ${f.unknown.join(", ")}`)
  assert.equal(r.ok, true, "GATE de CI: READMEs só citam comandos reais")
})
