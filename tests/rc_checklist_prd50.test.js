import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "dream", "rc-checklist-prd50.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

/** PRD50 S50.7 — RC checklist com claims em DOIS níveis. */

test("prd50Readiness: os 3 P0 são delivered -> ready:true", async () => {
  const { prd50Readiness, PRD50_RC_ITEMS } = await imp()
  const p0 = PRD50_RC_ITEMS.filter((i) => i.tier === "P0")
  assert.equal(p0.length, 3)
  for (const i of p0) assert.equal(i.status, "delivered", `${i.id}`)
  assert.equal(prd50Readiness().ready, true)
})

test("CONTROLE NEGATIVO: qualquer P0 pendente derruba ready", async () => {
  const { prd50Readiness, PRD50_RC_ITEMS } = await imp()
  const tampered = PRD50_RC_ITEMS.map((i) => (i.id === "P0.3" ? { ...i, status: "pending" } : i))
  const r = prd50Readiness(tampered)
  assert.equal(r.ready, false)
  assert.deepEqual(r.p0Pending, ["P0.3"])
})

test("cada item com proof aponta um arquivo que EXISTE de verdade", async () => {
  const { PRD50_RC_ITEMS } = await imp()
  for (const i of PRD50_RC_ITEMS.filter((x) => x.proof)) {
    assert.ok(existsSync(path.join(repoRoot, i.proof)), `${i.id}: ${i.proof}`)
  }
})

test("cobre os 8 sprints do programa (S50.0 a S50.7)", async () => {
  const { PRD50_RC_ITEMS } = await imp()
  const sprints = new Set(PRD50_RC_ITEMS.map((i) => i.sprint))
  for (const s of ["S50.0", "S50.1", "S50.2", "S50.3", "S50.4", "S50.5", "S50.6", "S50.7"]) {
    assert.ok(sprints.has(s), `cobre ${s}`)
  }
})

test("S50.6 permanece honestamente 'partial' — a fatia humana está aberta", async () => {
  const { PRD50_RC_ITEMS } = await imp()
  const bench = PRD50_RC_ITEMS.find((i) => i.sprint === "S50.6")
  assert.equal(bench.status, "partial")
})

// --- o que dá nome ao sprint: claims em dois níveis ---
test("todo claim AUTORIZADO cita uma prova que existe no disco", async () => {
  const { AUTHORIZED_CLAIMS } = await imp()
  assert.ok(AUTHORIZED_CLAIMS.length >= 5)
  for (const c of AUTHORIZED_CLAIMS) {
    assert.ok(existsSync(path.join(repoRoot, c.proof)), `claim sem prova real: ${c.claim}`)
  }
})

test("todo claim PENDENTE diz o que falta e por quê — nunca fica vago", async () => {
  const { PENDING_CLAIMS } = await imp()
  assert.ok(PENDING_CLAIMS.length >= 3)
  for (const c of PENDING_CLAIMS) {
    assert.ok(c.blockedBy, `${c.claim} precisa de blockedBy`)
    assert.ok(c.missing, `${c.claim} precisa dizer o que falta`)
  }
})

test("CONTROLE NEGATIVO: nenhum claim proibido pelo §17.2 aparece como autorizado", async () => {
  const { AUTHORIZED_CLAIMS } = await imp()
  const forbidden = [/reproduz.*aletheia/i, /deep think/i, /elimina.*alucinaç/i, /cientificamente correta/i, /python prova/i, /garante citaç/i]
  for (const c of AUTHORIZED_CLAIMS) {
    for (const rx of forbidden) assert.ok(!rx.test(c.claim), `claim proibido autorizado: ${c.claim}`)
  }
})

test("fullyValidated é FALSE enquanto houver claim pendente (por design, não esquecimento)", async () => {
  const { prd50Readiness } = await imp()
  const r = prd50Readiness()
  assert.equal(r.ready, true, "os P0 estão entregues")
  assert.equal(r.fullyValidated, false, "mas a validação completa depende de rótulo humano")
  assert.ok(r.counts.pendingClaims >= 3)
})

test("controle inverso: sem claims pendentes, fullyValidated vira true", async () => {
  const { prd50Readiness, PRD50_RC_ITEMS } = await imp()
  assert.equal(prd50Readiness(PRD50_RC_ITEMS, []).fullyValidated, true)
})

test("o E2E epistêmico está ligado à matriz de 3 SOs do CI", async () => {
  const ci = readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf-8")
  assert.match(ci, /epistemic_protocol\.e2e\.test\.js/, "o E2E precisa estar no workflow")
  const e2eJob = ci.slice(ci.indexOf("  e2e:"))
  assert.match(e2eJob, /ubuntu-latest, windows-latest, macos-latest/, "no job com matriz de 3 SOs")
})
