import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// deps fakes herméticos — proof NÃO reimplementa gates, só compõe.
const greenDeps = () => ({
  verify: () => ({ status: "ready", ready: true, failed: [], timedOut: [] }),
  dream: () => ({ summary: { REAL: 20, PARTIAL: 1, PLACEBO: 0, ROADMAP: 0, RISK: 0 }, scope: { target: "gstack_package" } }),
  readiness: () => ({ tools: {
    fallow: { status: "callable" }, graphify: { status: "callable", freshness: { state: "fresh", recommendedAction: null } },
    gstackContext: { status: "callable" }, headroom: { status: "callable_not_routed" },
  } }),
  git: () => "",
})

test("proof: tudo verde → ready:true, schema v1, exit 0", async () => {
  const { buildProof, PROOF_SCHEMA } = await imp("src/commands/proof.js")
  const p = buildProof({ cwd: "/x", profile: "release", deps: greenDeps() })
  assert.equal(p.schemaVersion, PROOF_SCHEMA)
  assert.equal(p.ready, true)
  assert.deepEqual(p.blockers, [])
  assert.equal(p.checks.verify.ok, true)
  assert.equal(p.checks.headroomRouting.status, "callable_not_routed", "claim honesto preservado")
})

test("proof: graphify stale → ready:false com recommendedAction (acceptance PRD26)", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  const deps = greenDeps()
  deps.readiness = () => ({ tools: {
    fallow: { status: "callable" },
    graphify: { status: "callable", freshness: { state: "stale", recommendedAction: "tools refresh --changed (ou `graphify update .`)" } },
    gstackContext: { status: "callable" }, headroom: { status: "callable_not_routed" },
  } })
  const p = buildProof({ cwd: "/x", deps })
  assert.equal(p.ready, false)
  assert.match(p.blockers.join(" | "), /graphify stale/)
  assert.match(p.checks.graphifyFreshness.recommendedAction, /tools refresh --changed/)
})

// Máquina limpa real (v3.79.1): rodar proof em C:\Users\x não pode reprovar por
// "graphify absent" (fora de projeto é estado honesto) nem auditar o HOME.
test("proof: graphify ABSENT → warning com ação, NÃO bloqueia (só stale bloqueia)", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  const deps = greenDeps()
  deps.readiness = () => ({ tools: {
    fallow: { status: "callable" },
    graphify: { status: "callable", freshness: { state: "absent", recommendedAction: "graphify index . (gera graphify-out/graph.json)" } },
    gstackContext: { status: "installed_not_callable" }, headroom: { status: "callable_not_routed" },
  } })
  const p = buildProof({ cwd: "/x", deps })
  assert.equal(p.ready, true, "absent não bloqueia")
  assert.match(p.warnings.join(" | "), /graphify absent.*graphify index/)
})

test("proof: dream audit mede O PRODUTO (package root), não o cwd", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  let receivedArgs = null
  const deps = greenDeps()
  deps.dream = (args) => { receivedArgs = args; return { summary: { REAL: 20, PARTIAL: 1, PLACEBO: 0, ROADMAP: 0, RISK: 0 }, scope: { target: "gstack_package" } } }
  const p = buildProof({ cwd: "C:/Users/alguem", deps })
  // PRD42 S42.0B: o proof audita em modo COMPORTAMENTAL — passa apenas { behavioral: true },
  // NUNCA root=cwd (o auditor usa o package root default; é o que prova "mede o PRODUTO").
  assert.equal(receivedArgs.root, undefined, "sem root=cwd — o auditor usa o package root default")
  assert.equal(receivedArgs.behavioral, true, "proof audita em modo comportamental")
  assert.equal(p.checks.dreamAudit.scope.target, "gstack_package")
})

test("proof: timeout_degraded vira WARNING acionável, nunca 'missing' silencioso", async () => {
  const { buildProof } = await imp("src/commands/proof.js")
  const deps = greenDeps()
  deps.readiness = () => ({ tools: {
    fallow: { status: "timeout_degraded" },
    graphify: { status: "callable", freshness: { state: "fresh" } },
    gstackContext: { status: "callable" }, headroom: { status: "callable_not_routed" },
  } })
  const p = buildProof({ cwd: "/x", deps })
  assert.match(p.warnings.join(" | "), /timeout.*NÃO é missing/i)
})

test("proof: verify blocked ou tree sujo → blockers específicos, exit 1 no CLI", async () => {
  const { buildProof, proofCommand } = await imp("src/commands/proof.js")
  const deps = greenDeps()
  deps.verify = () => ({ status: "blocked", failed: ["publish-guard"], timedOut: [] })
  deps.git = () => "?? solto.md"
  const p = buildProof({ cwd: "/x", deps })
  assert.equal(p.ready, false)
  assert.equal(p.blockers.length, 2)
  assert.match(p.blockers[0], /verify release: blocked/)
  assert.match(p.blockers[1], /git tree sujo/)
  // CLI --json: JSON puro + exitCode 1
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await proofCommand(["--json"], { cwd: "/x", deps }) } finally { process.stdout.write = orig }
  assert.equal(JSON.parse(buf.trim()).ready, false)
  assert.equal(process.exitCode, 1)
  process.exitCode = 0
})

test("proof: render humano cobre placar/avisos/bloqueios (sem --json)", async () => {
  const { proofCommand } = await imp("src/commands/proof.js")
  const deps = greenDeps()
  deps.readiness = () => ({ tools: {
    fallow: { status: "timeout_degraded" },
    graphify: { status: "callable", freshness: { state: "absent", recommendedAction: "graphify index ." } },
    gstackContext: { status: "callable" }, headroom: { status: "callable_not_routed" },
  } })
  const orig = process.stdout.write.bind(process.stdout)
  const origLog = console.log
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  console.log = (s = "") => { buf += String(s) + "\n" }
  try { await proofCommand([], { cwd: "/x", deps }) } finally { process.stdout.write = orig; console.log = origLog }
  assert.match(buf, /verify: ok/)
  assert.match(buf, /headroom: callable_not_routed/)
  assert.match(buf, /aviso:.*timeout/i)
  assert.match(buf, /PRONTO/, "veredito final impresso")
  process.exitCode = 0
})

test("readiness: probe com timeout classifica timeout_degraded (nunca missing) e re-tenta 1x", async () => {
  const { buildReadiness, STATUS_DESCRIPTIONS } = await imp("src/tools/readiness.js")
  assert.ok(STATUS_DESCRIPTIONS.timeout_degraded, "status documentado")
  let calls = 0
  const probe = (file, args) => {
    if (args && args[0] === "fallow") { calls += 1; return { ok: false, code: null, timedOut: true, stdout: "", stderr: "spawnSync ETIMEDOUT" } }
    return { ok: false, code: 1, stdout: "", stderr: "" }
  }
  const r = buildReadiness({ cwd: process.cwd(), home: process.cwd(), probe, git: () => null })
  assert.equal(calls, 2, "re-tentou exatamente 1x antes de classificar")
  assert.equal(r.tools.fallow.status, "timeout_degraded", "timeout NUNCA vira missing")
})

test("dream audit: scope declara alvo (gstack_package vs directory) — CM-08", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const here = audit({ root: repoRoot })
  assert.equal(here.scope.target, "gstack_package")
  assert.equal(here.scope.packageName, "@gstack-vibehard/installer")
  const elsewhere = audit({ root: path.join(repoRoot, "tests") })
  assert.equal(elsewhere.scope.target, "directory", "diretório sem o pacote é 'directory'")
})
