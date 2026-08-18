import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync, execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"
import { evaluateJsonRun } from "./helpers/json-purity.js"

/**
 * CONSUMIDOR REAL de `task run --json`.
 *
 * Evidência da declaração de consumidor de `src/commands/task-run.js`. Roda o
 * COMANDO PÚBLICO por subprocesso — `node src/index.js task run …` —, nunca
 * `taskRunCommand()` direto: chamar a função interna provaria que ela existe,
 * não que a superfície pública cumpre o contrato.
 *
 * A declaração é FILE-SCOPED, e não ancorada por comando, porque o arquivo
 * inteiro serve UM subcomando (`task run`) e tem um único export. É a mesma
 * forma exata usada por `create.js`. A âncora fina não se aplica aqui: o handler
 * do `DISPATCH` vive em `task.js`, que reexporta — a aresta cross-módulo não é
 * modelada pelo grafo, e por isso `commands` sai vazio.
 *
 * DOIS pontos de máquina, e os dois são exercitados:
 *
 *   :43  recusa `{"error":"plan_not_found"}` — literal já serializado
 *   :97  resultado completo do loop, com `planId`, contadores e branches
 *
 * ACHADO DE PRODUTO CORRIGIDO (`P1.CLI-JSON-EXIT-CODE`, fix autorizado em
 * 2026-08-17). As tres guardas de seguranca (repo git, `.env` rastreado, `--yes`
 * ausente) escreviam PROSA mesmo sob `--json`, e TODAS saiam com exit 0.
 *
 * Era a ocorrencia mais perigosa das tres: um consumidor de maquina que
 * recebesse a recusa por `.env` rastreado lia "o loop rodou bem", quando o loop
 * tinha se RECUSADO a rodar porque um segredo iria para a worktree.
  */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(repoRoot, "src", "index.js")

const rodar = (cwd, args) => evaluateJsonRun(spawnSync("node", [bin, "task", "run", ...args], {
  cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
}))

function assertRodou(r, nome) {
  assert.equal(r.spawnFailed, false, `${nome}: spawn falhou — o comando nem rodou`)
  assert.equal(r.timedOut, false, `${nome}: timeout — o resultado não representa o contrato`)
  assert.equal(r.signal, null, `${nome}: morto por sinal ${r.signal}`)
  assert.equal(r.ran, true, `${nome}: execução inválida`)
}

function payloadDe(cwd, args, nome) {
  const r = rodar(cwd, args)
  assertRodou(r, nome)
  assert.equal(r.pure, true, `${nome}: stdout não é documento JSON puro (motivo: ${r.reason})`)
  assert.equal(r.stderrHasStandaloneJson, false, `${nome}: payload de máquina não pode sair pelo stderr`)
  return r.doc
}

const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore" })

/** Repo git de verdade — o loop cria worktree por passo e exige um. */
function sandbox(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-taskrun-"))
  t.after(() => cleanupTmp(cwd))
  git(cwd, "init", "-q", ".")
  git(cwd, "config", "user.email", "t@t.dev")
  git(cwd, "config", "user.name", "t")
  git(cwd, "config", "commit.gpgsign", "false")
  writeFileSync(path.join(cwd, "README.md"), "# repo\n")
  git(cwd, "add", "-A")
  git(cwd, "commit", "-m", "init")
  return cwd
}

const comPlano = (cwd, id, steps) => {
  const pd = path.join(cwd, ".gstack", "tasks", id)
  mkdirSync(pd, { recursive: true })
  writeFileSync(path.join(pd, "task.json"), JSON.stringify({ id, request: "t", steps }))
  return pd
}

// ── Os dois pontos de máquina ──────────────────────────────────────────────

test("`task run --json` sem plano: recusa serializada, não prosa", (t) => {
  const p = payloadDe(sandbox(t), ["--json"], "sem plano")
  assert.equal(p.error, "plan_not_found",
    "o consumidor precisa distinguir 'não há plano' de 'o plano falhou'")
})

/**
 * O caminho de RESULTADO. O passo é rejeitado (não há mudança real a aplicar), e
 * isso não enfraquece a prova: o que se afere aqui é o CONTRATO do payload —
 * quais campos o consumidor recebe para decidir —, não o sucesso do loop.
 */
test("`task run <id> --yes --json`: resultado completo do loop", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p1", [{ id: "s1", title: "noop", command: "node -e 0" }])

  const p = payloadDe(cwd, ["p1", "--yes", "--json"], "run com plano")
  assert.equal(p.planId, "p1")
  assert.equal(typeof p.status, "string")
  for (const campo of ["accepted", "rejected", "skipped", "branches"]) {
    assert.ok(Array.isArray(p[campo]), `o consumidor precisa de \`${campo}\` como lista`)
  }
  assert.equal(typeof p.iterations, "number")
  assert.ok(p.branches.every((b) => b.startsWith("task/")),
    "cada passo vira um branch nomeado — é como a revisão humana encontra o trabalho")
})

// ── CONTROLES NEGATIVOS ────────────────────────────────────────────────────

test("CONTROLE NEGATIVO: sem `--json`, a recusa sai em prosa", (t) => {
  const r = rodar(sandbox(t), [])
  assertRodou(r, "sem --json")
  assert.equal(r.pure, false, "no ramo humano o stdout não pode ser documento JSON puro")
})

// ── As guardas sob `--json`: documento, nunca prosa ───────────────────────

/**
 * A GUARDA de `--yes` protege execução real em worktree. Ela sempre funcionou; o
 * que faltava era RESPONDER a quem chamou com `--json`.
 */
test("GUARDA `--yes`: documento puro, `blocked:true` e exit != 0", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p2", [{ id: "s1", title: "noop", command: "node -e 0" }])

  const r = rodar(cwd, ["p2", "--json"])
  assertRodou(r, "sem --yes")
  assert.equal(r.pure, true, `stdout precisa ser documento puro (motivo: ${r.reason})`)
  assert.equal(r.doc.blocked, true, "recusa por guarda é `blocked`, não falha de execução")
  assert.equal(r.doc.error, "confirmation_required")
  assert.notEqual(r.exitCode, 0)
})

/**
 * A GUARDA MAIS IMPORTANTE das três. `.env` rastreado no git significa que o
 * segredo iria para a worktree — e era exatamente aqui que o consumidor lia
 * exit 0 e prosa, ou seja, "rodou bem".
 */
test("GUARDA `.env` rastreado: recusa serializada, com o arquivo nomeado", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p3", [{ id: "s1", title: "noop", command: "node -e 0" }])
  writeFileSync(path.join(cwd, ".env"), "SECRET=1\n")
  git(cwd, "add", "-f", ".env")
  git(cwd, "commit", "-m", "env rastreado")

  const r = rodar(cwd, ["p3", "--yes", "--json"])
  assertRodou(r, "com .env rastreado")
  assert.equal(r.pure, true, `stdout precisa ser documento puro (motivo: ${r.reason})`)
  assert.equal(r.doc.error, "tracked_secrets",
    "o código diz o QUE bloqueou; o arquivo específico sai na prosa do modo humano")
  assert.notEqual(r.exitCode, 0, "exit 0 aqui seria ler 'segredo bloqueado' como 'tudo certo'")
})

test("GUARDA repositório git: recusa serializada", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-taskrun-nogit-"))
  t.after(() => cleanupTmp(cwd))
  comPlano(cwd, "p4", [{ id: "s1", title: "noop", command: "node -e 0" }])

  const r = rodar(cwd, ["p4", "--yes", "--json"])
  assertRodou(r, "fora de repo git")
  assert.equal(r.pure, true, `stdout precisa ser documento puro (motivo: ${r.reason})`)
  assert.equal(r.doc.error, "not_a_git_repo")
  assert.notEqual(r.exitCode, 0)
})

/**
 * `blocked` separado de `ok` NÃO é redundância: recusa por guarda e falha de
 * execução são estados diferentes para quem automatiza. Sem a distinção, um
 * consumidor trataria "não rodou porque eu chamei errado" igual a "rodou e
 * falhou" — e tentaria de novo, ou desistiria, na hora errada.
 */
test("o schema da recusa distingue `blocked` de `ok`", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p5", [{ id: "s1", title: "noop", command: "node -e 0" }])
  const r = rodar(cwd, ["p5", "--json"])
  assert.equal(r.doc.schemaVersion, "gstack.task-run.refusal.v1")
  assert.equal(r.doc.ok, false)
  assert.equal(r.doc.blocked, true)
  // Sem prosa no documento: consumidor de máquina decide por CÓDIGO. A frase
  // continua existindo — no ramo humano, que é de quem ela é.
  assert.equal("detail" in r.doc, false)
})

// ── Exit code: a raiz do P1 ───────────────────────────────────────────────

test("`plan_not_found` mantém o código público e ganha exit != 0", (t) => {
  const r = rodar(sandbox(t), ["--json"])
  assert.equal(r.doc.error, "plan_not_found", "o código já era público — preservado")
  assert.notEqual(r.exitCode, 0, "o que muda é o status, que era 0")
})

test("CONTROLE POSITIVO: o caminho de RESULTADO continua saindo com 0", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p6", [{ id: "s1", title: "noop", command: "node -e 0" }])
  const r = rodar(cwd, ["p6", "--yes", "--json"])
  assert.equal(r.exitCode, 0, "sem isto, o exit code não distinguiria recusa de execução")
  assert.equal(r.pure, true)
})

/**
 * O modo humano não muda: mesma prosa, mesmo canal. O status de saída passa a
 * valer para os dois — quem não usa `--json` merece o mesmo contrato.
 */
test("HUMANO: a guarda continua em prosa, e NÃO vira documento", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p7", [{ id: "s1", title: "noop", command: "node -e 0" }])
  const r = rodar(cwd, ["p7"])
  assertRodou(r, "sem --json")
  assert.equal(r.pure, false, "o ramo humano nunca pode virar documento JSON")
  assert.notEqual(r.exitCode, 0)
})
