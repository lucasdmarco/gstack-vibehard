import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "installer", "full-contract.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("evaluateFullContract: Full + degradado SEM --allow-degraded → BLOQUEIA", async () => {
  const { evaluateFullContract } = await imp()
  const r = evaluateFullContract({ degraded: [{ component: "gbrain", reason: "x" }], projectOnly: false, auditOnly: false, skipDeps: false, allowDegraded: false })
  assert.equal(r.block, true)
  assert.equal(r.isFull, true)
  assert.match(r.message, /NÃO cumprido|allow-degraded/)
})

test("evaluateFullContract: Full + degradado COM --allow-degraded → não bloqueia", async () => {
  const { evaluateFullContract } = await imp()
  const r = evaluateFullContract({ degraded: [{ component: "ECC", reason: "x" }], allowDegraded: true })
  assert.equal(r.block, false)
  assert.match(r.message, /DEGRADADA|prosseguindo/)
})

test("evaluateFullContract: Full + tudo OK → não bloqueia", async () => {
  const { evaluateFullContract } = await imp()
  assert.equal(evaluateFullContract({ degraded: [] }).block, false)
})

test("evaluateFullContract: Lite/project-only/audit-only TOLERAM degradação", async () => {
  const { evaluateFullContract } = await imp()
  const d = [{ component: "headroom", reason: "x" }]
  assert.equal(evaluateFullContract({ degraded: d, projectOnly: true }).block, false)
  assert.equal(evaluateFullContract({ degraded: d, auditOnly: true }).block, false)
  assert.equal(evaluateFullContract({ degraded: d, skipDeps: true }).block, false)
  assert.equal(evaluateFullContract({ degraded: d, projectOnly: true }).isFull, false)
})

test("trackDegraded: inicializa o array e DEDUPLICA por componente", async () => {
  const { trackDegraded } = await imp()
  const report = { added: [] }
  trackDegraded(report, "gbrain", "bun ausente")
  trackDegraded(report, "gbrain", "outra razão") // mesmo componente → ignora
  trackDegraded(report, "graphify", "uv ausente")
  assert.equal(report.degraded.length, 2)
  assert.deepEqual(report.degraded.map((d) => d.component).sort(), ["gbrain", "graphify"])
  assert.equal(report.degraded.find((d) => d.component === "gbrain").reason, "bun ausente", "mantém o 1º motivo")
})
