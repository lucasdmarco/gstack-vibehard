import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { cpSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const audMod = path.join(repoRoot, "src", "dream", "auditor.js")
const capMod = path.join(repoRoot, "src", "dream", "capabilities.js")
const cmdMod = path.join(repoRoot, "src", "commands", "dream.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

// PRD25 25.3: atualizado DELIBERADAMENTE — pre-render OPT-IN existe de verdade
// (src/security/redact-proxy.js + comando `proxy` + base-URL custom). A capability
// reflete a matriz honesta do guard-status.js: SÓ claude/codex/opencode; cursor e
// instrucionais seguem pós-resposta.
test("capabilities: pre-render OPT-IN só onde há base-URL custom; trust honesto", async () => {
  const { HARNESS_CAPABILITIES, getCapability, isStrongTrust } = await imp(capMod)
  const preRenderIds = Object.values(HARNESS_CAPABILITIES).filter((c) => c.supportsPreOutputInterception).map((c) => c.id).sort()
  assert.deepEqual(preRenderIds, ["claude", "codex", "opencode"], "exatamente os 3 com base-URL custom")
  for (const c of Object.values(HARNESS_CAPABILITIES)) {
    assert.ok(["strong", "partial", "best_effort"].includes(c.trustLevel))
    if (c.mode === "instructional" || c.mode === "detection") {
      assert.equal(c.supportsPreOutputInterception, false, `${c.id}: sem base-URL → sem pre-render`)
    }
  }
  assert.equal(isStrongTrust("claude"), true)
  assert.equal(isStrongTrust("hermes"), false, "hermes é best-effort, não forte")
  assert.equal(getCapability("inexistente").trustLevel, "best_effort")
})

test("audit: classifica claims, é determinístico e read-only (todas têm status)", async () => {
  const { audit } = await imp(audMod)
  const r = audit({ root: repoRoot })
  assert.ok(r.claims.length >= 6)
  const valid = new Set(["REAL", "PARTIAL", "PLACEBO", "ROADMAP", "RISK"])
  for (const c of r.claims) {
    assert.ok(valid.has(c.status), `${c.id} tem status válido`)
    assert.ok(c.severity && c.claim)
  }
  // Output Guard REAL (PRD25 25.3): proxy pre-render shipado + capability, com nota
  // honesta — opt-in, NUNCA Zero-Trust universal.
  const og = r.claims.find((c) => c.id === "output-guard")
  assert.equal(og.status, "REAL")
  assert.ok(og.evidence.includes("src/security/redact-proxy.js"), "evidência é o proxy real")
  assert.match(og.note, /OPT-IN/i, "nota declara opt-in")
  assert.match(og.note, /NÃO é Zero-Trust universal/, "nota impede overclaim")
  // verify e rollback são REAL (já entregues)
  assert.equal(r.claims.find((c) => c.id === "verify").status, "REAL")
  assert.equal(r.claims.find((c) => c.id === "rollback").status, "REAL")
  // truth-sync (PRD 12 PR1): o sprint entregue aparece como REAL no audit
  for (const id of ["runtime-supervisor", "secrets-broker", "runtime-manifest", "package-manager", "full-contract", "agent-factory", "agentshield", "adapter-matrix", "task-loop", "qa-multi-lens", "vfa-provenance", "challenge-response", "meta-harness", "type-coverage", "governance"]) {
    assert.equal(r.claims.find((c) => c.id === id).status, "REAL", `${id} deve ser REAL`)
  }
  // soma do summary == nº de claims
  assert.equal(Object.values(r.summary).reduce((a, b) => a + b, 0), r.claims.length)
})

test("audit: HONESTO no tarball publicado — só os `files` (sem tests/ nem .github/) → mesmo placar REAL", async () => {
  // Regressão v3.21.1: a máquina limpa expôs que o audit dependia de tests/ e
  // .github/ como evidência, que NÃO viajam na allowlist `files`. Resultado: toda
  // cópia instalada sub-declarava 14 capacidades reais. Aqui montamos a árvore EXATA
  // que o npm publica e exigimos o mesmo placar do repo (REAL idêntico, 0 PLACEBO).
  const { audit } = await imp(audMod)
  const full = audit({ root: repoRoot })

  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"))
  const shipped = await mkdtemp(path.join(tmpdir(), "gstack-shipped-"))
  try {
    cpSync(path.join(repoRoot, "package.json"), path.join(shipped, "package.json"))
    for (const entry of pkg.files) {
      const src = path.join(repoRoot, entry)
      if (!existsSync(src)) continue
      cpSync(src, path.join(shipped, entry), { recursive: true })
    }
    // garantia explícita: o que NÃO ship não foi copiado
    assert.ok(!existsSync(path.join(shipped, "tests")), "tests/ não viaja no tarball")
    assert.ok(!existsSync(path.join(shipped, ".github")), ".github/ não viaja no tarball")

    const onInstall = audit({ root: shipped })
    assert.equal(onInstall.summary.PLACEBO, 0, "instalação publicada não tem PLACEBO")
    assert.equal(onInstall.summary.REAL, full.summary.REAL, "REAL idêntico repo vs tarball")
    // claims gated por teste/CI antes mentiam — agora são REAL no tarball:
    for (const id of ["verify", "runtime-supervisor", "secrets-broker", "agent-factory", "vfa-provenance", "meta-harness", "governance", "type-coverage"]) {
      assert.equal(onInstall.claims.find((c) => c.id === id).status, "REAL", `${id} REAL no tarball`)
    }
  } finally { await rm(shipped, { recursive: true, force: true }) }
})

test("audit: roda contra repo vazio sem quebrar (claims viram PLACEBO/RISK)", async () => {
  const empty = await mkdtemp(path.join(tmpdir(), "gstack-dream-empty-"))
  try {
    const { audit } = await imp(audMod)
    const r = audit({ root: empty })
    assert.ok(r.claims.length >= 6, "não quebra sem arquivos")
  } finally { await rm(empty, { recursive: true, force: true }) }
})

test("dream audit --json: JSON puro com summary", async () => {
  const { dreamCommand } = await imp(cmdMod)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await dreamCommand(["audit", "--json"], { root: repoRoot }) } finally { process.stdout.write = orig }
  const out = JSON.parse(buf.trim())
  assert.ok(out.summary && Array.isArray(out.claims))
})

// PRD25 25.4: `improve` saiu de not_implemented — agora é fluxo isolado real.
// (O teste completo vive em tests/dream_improve.test.js; aqui só o contrato do audit.)
test("audit: auto-dream vira REAL com o runner de improve shipado", async () => {
  const { audit } = await imp(audMod)
  const r = audit({ root: repoRoot })
  const ad = r.claims.find((c) => c.id === "auto-dream")
  assert.equal(ad.status, "REAL", "src/dream/runner.js + subcomando improve ⇒ REAL")
  assert.deepEqual(ad.missing, [])
})

// PRD25 25.5: cross-harness-trust é PARTIAL POR DESIGN — a nota impede tanto o
// overclaim ("Zero-Trust universal") quanto o falso-negativo (tratar como bug).
test("audit: cross-harness-trust PARTIAL por design, com nota anti-overclaim", async () => {
  const { audit } = await imp(audMod)
  const r = audit({ root: repoRoot })
  const ct = r.claims.find((c) => c.id === "cross-harness-trust")
  assert.equal(ct.status, "PARTIAL", "instrucionais existem ⇒ PARTIAL é o estado honesto")
  assert.match(ct.note, /por design/i, "nota explica que é deliberado")
  assert.match(ct.note, /Zero-Trust universal não é um claim/i, "nota impede overclaim")
  assert.match(ct.missing[0], /best-effort/, "lista os harness que não impõem gates")
})

test("dream inspect segue honesto (not_implemented), não finge executar", async () => {
  const { dreamCommand } = await imp(cmdMod)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await dreamCommand(["inspect", "--json"], {}) } finally { process.stdout.write = orig }
  assert.equal(JSON.parse(buf.trim()).error, "not_implemented")
})
