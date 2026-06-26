import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const audMod = path.join(repoRoot, "src", "dream", "auditor.js")
const capMod = path.join(repoRoot, "src", "dream", "capabilities.js")
const cmdMod = path.join(repoRoot, "src", "commands", "dream.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

test("capabilities: nenhum harness intercepta o render (pré-output false); trust honesto", async () => {
  const { HARNESS_CAPABILITIES, getCapability, isStrongTrust } = await imp(capMod)
  for (const c of Object.values(HARNESS_CAPABILITIES)) {
    assert.equal(c.supportsPreOutputInterception, false, `${c.id}: CLI não intercepta render`)
    assert.ok(["strong", "partial", "best_effort"].includes(c.trustLevel))
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
  // Output Guard é RISK (pós-resposta, sem intercept pré-render)
  assert.equal(r.claims.find((c) => c.id === "output-guard").status, "RISK")
  // verify e rollback são REAL (já entregues)
  assert.equal(r.claims.find((c) => c.id === "verify").status, "REAL")
  assert.equal(r.claims.find((c) => c.id === "rollback").status, "REAL")
  // truth-sync (PRD 12 PR1): o sprint entregue aparece como REAL no audit
  for (const id of ["runtime-supervisor", "secrets-broker", "runtime-manifest", "package-manager", "full-contract"]) {
    assert.equal(r.claims.find((c) => c.id === id).status, "REAL", `${id} deve ser REAL`)
  }
  // soma do summary == nº de claims
  assert.equal(Object.values(r.summary).reduce((a, b) => a + b, 0), r.claims.length)
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

test("dream improve: honesto (not_implemented), não finge executar", async () => {
  const { dreamCommand } = await imp(cmdMod)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await dreamCommand(["improve", "--json"], {}) } finally { process.stdout.write = orig }
  assert.equal(JSON.parse(buf.trim()).error, "not_implemented")
})
