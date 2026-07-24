import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "commands", "verify.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

async function project() {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-rb-"))
  await writeFile(path.join(cwd, "AGENTS.md"), "# Regras do projeto\n")
  return cwd
}

/**
 * PRD51 S51.0C parte 2 — wiring do release baseline no `verify --profile full`.
 * Decisão do usuário: ADVISORY (opção 1). O publish-guard já falha-fechado nos
 * gates reais (source-parity/dream-required/capability-e2e/golden-workflow); o
 * baseline aqui é só um crédito-resumo desses estados PARA ESTE commit — nunca
 * um segundo gate, nunca muda `report.status`.
 */

test("verify --json: releaseBaseline aparece como campo ADVISORY, atribuído ao commit atual", async () => {
  const cwd = await project()
  try {
    const { verifyCommand } = await imp()
    const exec = () => "abc1234\n"
    const r = await verifyCommand(["--json"], { cwd, exec, runId: "rb1" })
    assert.ok(r.releaseBaseline, "releaseBaseline deve estar presente no report")
    assert.equal(r.releaseBaseline.advisory, true)
    assert.equal(r.releaseBaseline.provenance.commit, "abc1234")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("CONTROLE: releaseBaseline NUNCA sobrescreve report.status (é advisory, não gate)", async () => {
  const cwd = await project()
  try {
    const { verifyCommand } = await imp()
    const exec = () => { throw new Error("git indisponível neste teste") }
    const r = await verifyCommand(["--json"], { cwd, exec, runId: "rb2" })
    const statusBefore = r.status
    assert.ok(r.releaseBaseline, "mesmo sem git resolvível, releaseBaseline existe (commit:null, honesto)")
    assert.equal(r.releaseBaseline.provenance.commit, null, "git indisponível -> commit null, nunca inventado")
    assert.equal(r.status, statusBefore, "status do verify não muda por causa do baseline")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("CONTROLE: sem programItems/humanValidation reais ainda (Sprint 51.3 não fez o ledger), completeVerdict é honestamente NÃO-ok", async () => {
  const cwd = await project()
  try {
    const { verifyCommand } = await imp()
    const exec = () => "deadbeef"
    const r = await verifyCommand(["--json"], { cwd, exec, runId: "rb3" })
    assert.equal(r.releaseBaseline.completeVerdict.ok, false, "sem ledger de programa/validação humana wired -> nunca 'concluído' por omissão")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
