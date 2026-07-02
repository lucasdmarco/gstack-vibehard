import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const GLOBAL_WRITE = {
  intent: "edit_file",
  target: { scope: "global", pathOrName: "C:\\Users\\x\\.claude\\settings.json" },
}

test("pretoolCheck: risco baixo → allow direto (sem provenance de bloqueio)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-pretool-"))
  try {
    const { pretoolCheck } = await imp("src/vfa/pretool.js")
    const r = pretoolCheck(tmp, { intent: "edit_file", target: { scope: "project", pathOrName: "src/a.js" } })
    assert.deepEqual(r, { decision: "allow", risk: "low" })
  } finally { await rm(tmp, { recursive: true, force: true }) }
})

test("pretoolCheck: alto risco SEM grant → deny com challenge + howTo + recibo", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-pretool-"))
  try {
    const { pretoolCheck } = await imp("src/vfa/pretool.js")
    const { readRun } = await imp("src/vfa/provenance.js")
    const r = pretoolCheck(tmp, GLOBAL_WRITE, { harness: "claude" })
    assert.equal(r.decision, "deny")
    assert.equal(r.rule, "global-config-write")
    assert.match(r.challenge, /alto risco/)
    assert.match(r.howTo, /challenge evaluate .*--scope global .*--evidence/)
    assert.deepEqual(r.requiredEvidence, ["install-manifest-owner", "backup-path", "rollback-plan"])
    // a decisão pretool virou recibo encadeado
    const receipts = readRun(tmp, "pretool")
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].policy.decision, "deny")
  } finally { await rm(tmp, { recursive: true, force: true }) }
})

test("fluxo completo: challenge evaluate com evidência → grant → pretool allow", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-pretool-"))
  try {
    const { challengeCommand } = await imp("src/commands/challenge.js")
    const { pretoolCheck } = await imp("src/vfa/pretool.js")

    // 1) pretool nega sem justificativa
    assert.equal(pretoolCheck(tmp, GLOBAL_WRITE).decision, "deny")

    // 2) o agente responde o challenge com TODAS as evidências (grava recibo allow)
    const buf = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf.push(String(s)); return true }
    let evalOut
    try {
      evalOut = challengeCommand([
        "evaluate", "--json",
        "--intent", "edit_file", "--target", GLOBAL_WRITE.target.pathOrName, "--scope", "global",
        "--harness", "claude",
        "--evidence", "install-manifest-owner,backup-path,rollback-plan",
      ], { cwd: tmp })
    } finally { process.stdout.write = orig }
    assert.equal(evalOut.decision, "allow")

    // 3) pretool agora ALLOW com grantedBy apontando o recibo
    const r = pretoolCheck(tmp, GLOBAL_WRITE, { harness: "claude" })
    assert.equal(r.decision, "allow")
    assert.equal(r.risk, "high")
    assert.ok(r.grantedBy, "carrega o hash do recibo que autorizou")
  } finally { await rm(tmp, { recursive: true, force: true }) }
})

test("grant EXPIRADO (fora do TTL) → volta a negar", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-pretool-"))
  try {
    const { challengeCommand } = await imp("src/commands/challenge.js")
    const { pretoolCheck } = await imp("src/vfa/pretool.js")
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      challengeCommand([
        "evaluate", "--json",
        "--intent", "edit_file", "--target", GLOBAL_WRITE.target.pathOrName, "--scope", "global",
        "--evidence", "install-manifest-owner,backup-path,rollback-plan",
      ], { cwd: tmp })
    } finally { process.stdout.write = orig }

    // agora = 16 minutos no futuro → grant de 15min expirou
    const future = Date.now() + 16 * 60 * 1000
    const r = pretoolCheck(tmp, GLOBAL_WRITE, { now: future })
    assert.equal(r.decision, "deny", "grant fora do TTL não vale")
  } finally { await rm(tmp, { recursive: true, force: true }) }
})

test("grant NÃO transfere entre alvos diferentes (mesma regra, outro arquivo)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-pretool-"))
  try {
    const { challengeCommand } = await imp("src/commands/challenge.js")
    const { pretoolCheck } = await imp("src/vfa/pretool.js")
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      challengeCommand([
        "evaluate", "--json",
        "--intent", "edit_file", "--target", GLOBAL_WRITE.target.pathOrName, "--scope", "global",
        "--evidence", "install-manifest-owner,backup-path,rollback-plan",
      ], { cwd: tmp })
    } finally { process.stdout.write = orig }

    const other = { intent: "edit_file", target: { scope: "global", pathOrName: "C:\\Users\\x\\.codex\\config.toml" } }
    assert.equal(pretoolCheck(tmp, other).decision, "deny", "grant é por regra+alvo, não global")
  } finally { await rm(tmp, { recursive: true, force: true }) }
})
