import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const sc = (audit, k) => audit.summary[k] || 0 // contagem de um status (0 se ausente)

// ── P1.6: Dream Audit comportamental ─────────────────────────────────────────────
test("gradeClaimStatus: REAL sem contrato comportamental → NOT_PROVED (arquivo não basta)", async () => {
  const { gradeClaimStatus, NOT_PROVED } = await imp("src/dream/claim-contract.js")
  assert.equal(gradeClaimStatus("REAL", null), NOT_PROVED, "arquivo presente ≠ REAL")
  assert.equal(gradeClaimStatus("REAL", { evidenceAdapter: "x" }), NOT_PROVED, "contrato incompleto não prova")
  assert.equal(gradeClaimStatus("PARTIAL", null), "PARTIAL", "PARTIAL não é rebaixado nem elevado")
  assert.equal(gradeClaimStatus("RISK", null), "RISK", "RISK passa intacto")
})

test("gradeClaimStatus: contrato comportamental completo mantém REAL", async () => {
  const { gradeClaimStatus, contractFor } = await imp("src/dream/claim-contract.js")
  const c = contractFor("verify")
  assert.ok(c, "verify tem contrato comportamental")
  assert.equal(gradeClaimStatus("REAL", c), "REAL")
})

test("audit({behavioral:true}): a queda honesta — só claims com contrato seguem REAL", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const normal = audit({ root: repoRoot })
  const behavioral = audit({ root: repoRoot, behavioral: true })
  assert.equal(behavioral.behavioral, true)
  assert.ok(sc(behavioral, "REAL") < sc(normal, "REAL"), "REAL cai no modo comportamental")
  assert.ok(sc(behavioral, "NOT_PROVED") > 0, "aparecem NOT_PROVED")
  // pelo menos 'verify' (com contrato) segue REAL
  assert.equal(behavioral.claims.find((c) => c.id === "verify").status, "REAL")
  // RISK/PLACEBO não mudam → o proof (que checa RISK/PLACEBO) não é afetado
  assert.equal(sc(behavioral, "RISK"), sc(normal, "RISK"))
  assert.equal(sc(behavioral, "PLACEBO"), sc(normal, "PLACEBO"))
})

// ── P1.8: Closeout transacional ──────────────────────────────────────────────────
test("buildCloseout: refresh ok → fresh:true; refresh falho/degraded → fresh:false", async () => {
  const { buildCloseout } = await imp("src/skills/closeout.js")
  assert.equal(buildCloseout({ toolsRefresh: { ran: true, state: "ok" } }).fresh, true)
  assert.equal(buildCloseout({ toolsRefresh: { ran: true, state: "degraded", error: "timeout" } }).fresh, false, "refresh degradado remove o claim fresh")
  assert.equal(buildCloseout({ toolsRefresh: { ran: false, state: "not_run" } }).fresh, false)
  assert.equal(buildCloseout({}).fresh, false, "sem refresh não é fresh")
})

// ── RC: checklist DoD §10 do PRD40 ───────────────────────────────────────────────
test("rcReadiness: TODOS os 10 P0 entregues → ready:true", async () => {
  const { rcReadiness, RC_ITEMS } = await imp("src/dream/rc-checklist.js")
  const r = rcReadiness()
  assert.equal(r.counts.p0, 10, "os 10 bloqueadores P0 do PRD40 estão no checklist")
  assert.equal(r.counts.p0Delivered, 10, "todos os P0 entregues")
  assert.equal(r.ready, true, "RC pronto quando todo P0 está delivered")
  assert.deepEqual(r.p0Pending, [])
  // cada item aponta um artefato de prova
  for (const it of RC_ITEMS) assert.ok(it.proof && it.title, `item ${it.id} sem prova/título`)
})

test("rcReadiness: um P0 pendente derruba ready (fail-closed)", async () => {
  const { rcReadiness, RC_ITEMS } = await imp("src/dream/rc-checklist.js")
  const mutated = RC_ITEMS.map((i) => (i.id === "P0.1" ? { ...i, status: "pending" } : i))
  const r = rcReadiness(mutated)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.1"])
})
