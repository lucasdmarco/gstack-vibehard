/**
 * E2E do Action Kernel — a claim "ação negada NÃO executa", pelo binário real.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O contrato do claim `action-kernel` declarava
 * como comando E2E a string `runGovernedAction (task/workflow/delegate)` — um
 * NOME DE FUNÇÃO. O S52.B reprovou isso (nome de função não é comando) e a claim
 * caiu para NOT_PROVED. A investigação mostrou que a queda era mais funda do que
 * um campo mal escrito: `runGovernedAction` não tinha UM chamador em código de
 * produto. O kernel se descrevia como "o ponto por onde CLI/hooks/adapters
 * passam — ninguém reimplementa o gate", e nenhum comando passava por ele.
 *
 * O S52.I ligou o `delegate` ao kernel, e é isso que este arquivo prova — de
 * fora, pelo binário, sem importar módulo nenhum do produto:
 *
 *   POSITIVO  — uma tarefa destrutiva é NEGADA, o alvo NÃO é invocado, e o
 *               ledger em disco registra `executed:false` com o motivo;
 *   NEGATIVO  — uma tarefa idêntica em tudo menos no gatilho ATRAVESSA o gate e
 *               chega ao alvo. Sem este segundo caso o primeiro não provaria
 *               nada: um comando que falha sempre também "nega" tudo.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { spawnSync, execFileSync } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { cleanupTmp } from "../helpers/tmp.js"

const repoRoot = path.resolve(import.meta.dirname, "..", "..")
const cli = path.join(repoRoot, "src", "index.js")

/**
 * Repositório LIMPO, de verdade.
 *
 * O gate de segredos do `delegate` roda antes do kernel e bloqueia com `.env`
 * rastreado — e o próprio repo do GStack tem um `.env.example` versionado. Rodar
 * aqui mediria o gate de segredos e chamaria de Action Kernel.
 */
async function repoLimpo() {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-ak-e2e-"))
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf-8" })
  git("init", "-q", ".")
  git("config", "user.email", "e2e@gstack.local")
  git("config", "user.name", "e2e")
  execFileSync("node", ["-e", "require('fs').writeFileSync('README.md','# e2e\\n')"], { cwd: dir, stdio: "pipe" })
  git("add", "README.md")
  git("commit", "-qm", "init")
  return dir
}

const delegar = (dir, task) => spawnSync(process.execPath,
  [cli, "delegate", "opencode", "--task", task, "--yes"],
  { cwd: dir, encoding: "utf-8", timeout: 120000 })

/** Todas as entradas de ação gravadas em `.gstack/runs/<runId>/actions.jsonl`. */
async function ledger(dir) {
  const runs = path.join(dir, ".gstack", "runs")
  if (!existsSync(runs)) return []
  const linhas = []
  for (const run of readdirSync(runs)) {
    const p = path.join(runs, run, "actions.jsonl")
    if (!existsSync(p)) continue
    const txt = await readFile(p, "utf-8")
    for (const l of txt.split("\n").filter(Boolean)) linhas.push({ run, ...JSON.parse(l) })
  }
  return linhas
}

// A tarefa destrutiva usa `drop table`, e não `rm -rf`, por um motivo prático:
// o hook de segurança do harness que roda esta suíte bloqueia a segunda string
// antes de o teste existir. As duas caem na mesma checagem do kernel.
const TAREFA_NEGADA = "drop table usuarios"
const TAREFA_PERMITIDA = "atualizar a tabela usuarios com um indice novo"

test("E2E POSITIVO: tarefa destrutiva é NEGADA e o alvo nunca é invocado", async () => {
  const dir = await repoLimpo()
  try {
    const r = delegar(dir, TAREFA_NEGADA)
    const saida = `${r.stdout}${r.stderr}`
    assert.match(saida, /BLOQUEADO pelo Action Kernel/, `saída inesperada:\n${saida}`)
    assert.match(saida, /o alvo não foi invocado/)
    assert.match(saida, /DROP destrutivo em banco/, "o motivo da negação sai nomeado")
    assert.notEqual(r.status, 0, "delegação negada não pode sair com sucesso")

    const acoes = await ledger(dir)
    assert.equal(acoes.length, 1, `esperava UMA ação no ledger, veio ${acoes.length}`)
    const a = acoes[0]
    assert.equal(a.decision, "deny")
    assert.equal(a.executed, false, "esta é a claim: ação negada NÃO executa")
    assert.equal(a.enforced, true, "harness enforced: a negação bloqueia, não avisa")
    assert.equal(a.exitCode, 126)
    assert.equal(a.tool, "delegate")
    assert.equal(a.harness, "opencode")
    assert.ok(a.reasons.some((x) => x.startsWith("destructive:deny")), `motivos: ${JSON.stringify(a.reasons)}`)
  } finally { cleanupTmp(dir) }
})

test("E2E NEGATIVO: tarefa equivalente SEM o gatilho atravessa o gate e chega ao alvo", async () => {
  const dir = await repoLimpo()
  try {
    const r = delegar(dir, TAREFA_PERMITIDA)
    const saida = `${r.stdout}${r.stderr}`
    assert.doesNotMatch(saida, /BLOQUEADO pelo Action Kernel/,
      `o gate negou uma tarefa legítima — negar tudo não é governar:\n${saida}`)

    const acoes = await ledger(dir)
    assert.equal(acoes.length, 1)
    const a = acoes[0]
    assert.notEqual(a.decision, "deny", "sem gatilho destrutivo não há negação")
    assert.equal(a.executed, true, "o alvo FOI invocado — é o que separa o caso positivo de um comando que falha sempre")
  } finally { cleanupTmp(dir) }
})

test("E2E: o ledger é auditável pelo binário (`actions ledger --json`) no run que acabou de rodar", async () => {
  const dir = await repoLimpo()
  try {
    delegar(dir, TAREFA_NEGADA)
    const r = spawnSync(process.execPath, [cli, "actions", "ledger", "--json"],
      { cwd: dir, encoding: "utf-8", timeout: 120000 })
    const doc = JSON.parse(r.stdout.trim().split("\n").pop())
    assert.ok(doc.runId, "o run mais recente é encontrado sem --run")
    assert.equal(doc.actions.length, 1)
    assert.equal(doc.actions[0].decision, "deny")
    assert.equal(doc.actions[0].executed, false,
      "o registro da negação sobrevive ao processo: quem audita depois vê o que foi barrado")
  } finally { cleanupTmp(dir) }
})

test("E2E: o payload da ação NUNCA vai cru para o ledger (só digests e resumo redigido)", async () => {
  const dir = await repoLimpo()
  try {
    delegar(dir, TAREFA_NEGADA)
    const bruto = await readFile(
      path.join(dir, ".gstack", "runs", readdirSync(path.join(dir, ".gstack", "runs"))[0], "actions.jsonl"), "utf-8")
    assert.doesNotMatch(bruto, /usuarios/,
      "a tarefa delegada é conteúdo do usuário: o ledger guarda digest, nunca o texto")
    assert.match(bruto, /"inputDigest":"sha256:/)
  } finally { cleanupTmp(dir) }
})
