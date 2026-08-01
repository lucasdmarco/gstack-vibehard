import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PRD51 S51.10.3 — lint dos manuais INTERNOS (§51.10 item 5 dos Manuais).
 *
 * O que este arquivo protege, em ordem de importância:
 *
 *  1. que ausência de manual NUNCA reprove (`.docs/` é gitignored — a CI não tem os
 *     arquivos, e um gate que pune a CI por um fato de design é um gate quebrado);
 *  2. que baseline defasada seja DETECTADA — o drift real do manual nunca foi comando
 *     inventado, foi a versão declarada envelhecer em silêncio;
 *  3. que manual sem check aplicável não produza VERDE — o verde vazio é pior que não
 *     checar, porque dá impressão de cobertura onde não há o que cobrir.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "meta", "manual-lint.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("parseDeclaredBaseline lê a baseline real do manual do projeto", async () => {
  const { parseDeclaredBaseline } = await imp()
  const b = parseDeclaredBaseline("> Baseline consultada: CLI local `v5.19.0`, em 2026-07-21.")
  assert.equal(b.version, "5.19.0")
  assert.equal(b.date, "2026-07-21")
})

test("manual SEM baseline declarada é drift — não poder conferir é a PIOR situação, não a neutra", async () => {
  const { parseDeclaredBaseline, baselineDrift } = await imp()
  const d = baselineDrift(parseDeclaredBaseline("# Manual sem declaração de versão"), "5.102.0")
  assert.equal(d.drifted, true)
  assert.equal(d.kind, "missing_baseline")
})

test("drift é por MAJOR/MINOR; patch não conta (manual descreve capacidade, patch não muda capacidade)", async () => {
  const { baselineDrift } = await imp()
  assert.equal(baselineDrift({ version: "5.102.0" }, "5.102.7").drifted, false, "patch não é drift")
  assert.equal(baselineDrift({ version: "5.19.0" }, "5.102.0").drifted, true, "minor defasado é drift")
  assert.equal(baselineDrift({ version: "4.102.0" }, "5.102.0").drifted, true, "major defasado é drift")
})

test("AUSÊNCIA nunca reprova — `.docs/` é gitignored e a CI não tem os manuais", async () => {
  const { runManualLint } = await imp()
  const r = runManualLint({
    manuals: [{ path: ".docs/PLANS/projetogstack.md", text: null, checksCommands: true, checksBaseline: true }],
    cliVersion: "5.102.0",
  })
  assert.equal(r.ok, true, "arquivo ausente jamais pode falhar o lint")
  assert.equal(r.skipped, 1)
  assert.equal(r.checked, 0)
})

test("manual sem check aplicável sai como `notApplicable`, NUNCA como verde", async () => {
  const { runManualLint } = await imp()
  const r = runManualLint({
    manuals: [{ path: ".docs/PLANS/manualdeengenhariacomia.md", text: "# Manual", checksCommands: false, checksBaseline: false, reason: "vendor-neutral, não cita CLI" }],
    cliVersion: "5.102.0",
  })
  assert.equal(r.notApplicable, 1)
  assert.equal(r.checked, 0, "não pode contar como verificado o que não foi verificado")
  assert.ok(r.perManual[0].reason, "a razão de não checar fica registrada")
})

test("DETECTA baseline defasada num manual presente (o drift que motivou este módulo)", async () => {
  const { runManualLint } = await imp()
  const r = runManualLint({
    manuals: [{ path: "m.md", text: "> Baseline consultada: CLI local `v5.19.0`, em 2026-07-21.", checksCommands: false, checksBaseline: true }],
    cliVersion: "5.102.0",
  })
  assert.equal(r.ok, false)
  assert.equal(r.perManual[0].drift.kind, "stale_baseline")
  assert.equal(r.perManual[0].drift.declared, "5.19.0")
})

test("CONTROLE POSITIVO: baseline em dia passa — o gate é alcançável, não decorativo", async () => {
  const { runManualLint } = await imp()
  const r = runManualLint({
    manuals: [{ path: "m.md", text: "> Baseline consultada: CLI local `v5.102.0`, em 2026-08-01.", checksCommands: false, checksBaseline: true }],
    cliVersion: "5.102.0",
  })
  assert.equal(r.ok, true)
})

test("DETECTA comando inexistente citado em bloco de código do manual", async () => {
  const { runManualLint } = await imp()
  const r = runManualLint({
    manuals: [{ path: "m.md", text: "Rode `gstack_vibehard comandoquenaoexiste --json` para isso.", checksCommands: true, checksBaseline: false }],
    cliVersion: "5.102.0",
  })
  assert.equal(r.ok, false)
  assert.deepEqual(r.perManual[0].unknown, ["comandoquenaoexiste"])
})

test("o manual do projeto, se presente, não cita comando inexistente (guarda de regressão)", async () => {
  const { runManualLint } = await imp()
  const p = path.join(repoRoot, ".docs", "PLANS", "projetogstack.md")
  if (!existsSync(p)) return // gitignored: na CI simplesmente não há o que checar
  const r = runManualLint({
    manuals: [{ path: p, text: readFileSync(p, "utf-8"), checksCommands: true, checksBaseline: false }],
    cliVersion: "5.102.0",
  })
  assert.deepEqual(r.perManual[0].unknown, [], "manual interno é fonte de curadoria das claims públicas")
})

test("INTERNAL_MANUALS: todo manual com check desligado registra a RAZÃO", async () => {
  const { INTERNAL_MANUALS } = await imp()
  for (const m of INTERNAL_MANUALS.filter((x) => !x.checksCommands || !x.checksBaseline)) {
    assert.ok(m.reason && m.reason.length > 30, `${m.path} explica por que não é checado`)
  }
})
