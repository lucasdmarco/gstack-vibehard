import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "commands", "verify.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" })

/**
 * PRD54 §2.2 (S54.3) — o guard de workspace LIGADO no `verify`.
 *
 * O §2.2 proíbe "resultado verde, JSON vazio ou evidência parcial tratada como
 * conclusão". Este arquivo prova o wiring: sem ele, `workspace-snapshot.js` seria
 * o quinto módulo desta leva construído, testado e sem consumidor — depois de
 * `runGovernedAction`, `codex-hooks-doctor`, `complianceReport` e os `receipts`
 * de `construirMatriz`.
 */

function projeto({ comGit = true } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-wsg-"))
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Regras do projeto\n")
  if (!comGit) return cwd
  git(["init", "-q"], cwd)
  git(["config", "user.email", "t@t.t"], cwd)
  git(["config", "user.name", "t"], cwd)
  git(["add", "-A"], cwd)
  git(["commit", "-q", "-m", "inicial"], cwd)
  return cwd
}

test("o report carrega `sourceCommit` e `workspaceSnapshotHash` FIXADOS", async () => {
  const cwd = projeto()
  try {
    const { verifyCommand } = await imp()
    const r = await verifyCommand(["--json"], { cwd, exec: () => "abc1234\n", runId: "ws1" })
    assert.ok(r.workspace, "sem este campo, o §2.2 não tem onde ser medido")
    assert.match(r.workspace.sourceCommit, /^[0-9a-f]{40}$/)
    assert.match(r.workspace.workspaceSnapshotHash, /^[0-9a-f]{64}$/)
    assert.equal(r.workspace.verified, true)
    assert.equal(r.workspace.stable, true)
    assert.notEqual(r.status, "inconclusive", "árvore parada não pode virar inconclusivo")
  } finally { cleanupTmp(cwd) }
})

/**
 * O EXPERIMENTO. A árvore muda DURANTE o run — exatamente o que aconteceu neste
 * repositório quando outra sessão reverteu arquivos no meio da suíte.
 *
 * O gancho é o `stepExec`: ele roda entre o snapshot inicial e o final, que é
 * onde uma sessão concorrente escreveria.
 */
test("árvore mudando DURANTE o run derruba o veredito para `inconclusive`", async () => {
  const cwd = projeto()
  try {
    const { verifyCommand } = await imp()
    const stepExec = () => {
      writeFileSync(path.join(cwd, "intruso.txt"), "escrito por outra sessão\n")
      return { status: 0, stdout: "", stderr: "" }
    }
    const r = await verifyCommand(["--json"], { cwd, exec: () => "abc1234\n", stepExec, runId: "ws2" })

    assert.equal(r.status, "inconclusive")
    assert.match(r.inconclusiveReason, /workspace_changed/)
    assert.equal(r.workspace.changed, true)
    assert.equal(r.workspace.stable, false)
    assert.ok(r.workspace.changedPaths.includes("intruso.txt"),
      `precisa NOMEAR o que mudou; veio ${JSON.stringify(r.workspace.changedPaths)}`)
  } finally { cleanupTmp(cwd) }
})

/**
 * CONTROLE NEGATIVO do escopo: um projeto SEM git não pode ser acusado de
 * instabilidade. Bloquear aqui puniria o usuário por não usar git — e o `verify`
 * existe justamente para projeto que está nascendo.
 */
test("projeto SEM git roda normal: não bloqueia, e não finge estabilidade", async () => {
  const cwd = projeto({ comGit: false })
  try {
    const { verifyCommand } = await imp()
    const r = await verifyCommand(["--json"], { cwd, exec: () => "abc1234\n", runId: "ws3" })
    assert.notEqual(r.status, "inconclusive")
    assert.equal(r.workspace.verified, false, "não houve verificação")
    assert.equal(r.workspace.stable, null, "`true` aqui afirmaria estabilidade que ninguém observou")
    assert.equal(r.workspace.kind, "no_git")
  } finally { cleanupTmp(cwd) }
})

/**
 * `inconclusive` não é `blocked`, e a diferença é a do §2.2: os gates não
 * reprovaram — a medição perdeu o objeto. Antes deste sprint, um status
 * desconhecido caía no `else` que dizia "BLOQUEADO — gates obrigatórios
 * falharam", acusando os gates de uma falha que não houve.
 */
test("`inconclusive` NÃO é `blocked` — os gates não reprovaram", async () => {
  const cwd = projeto()
  try {
    const { verifyCommand } = await imp()
    const stepExec = () => {
      writeFileSync(path.join(cwd, "intruso.txt"), "x\n")
      return { status: 0, stdout: "", stderr: "" }
    }
    const r = await verifyCommand(["--json"], { cwd, exec: () => "abc1234\n", stepExec, runId: "ws4" })
    assert.equal(r.status, "inconclusive")
    assert.notEqual(r.status, "blocked")
    assert.ok(r.inconclusiveReason, "o motivo precisa viajar junto, senão o status é mudo")
  } finally { cleanupTmp(cwd) }
})
