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
 * ACHADO DE PRODUTO, fixado e NÃO corrigido: as três guardas de segurança
 * (repo git, `.env` rastreado, `--yes` ausente) escrevem PROSA mesmo sob
 * `--json`. É a mesma classe já registrada em P1.CLI-JSON-EXIT-CODE.b para
 * `research` — aqui é a terceira ocorrência, e o teste a fixa no estado
 * observado.
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

/**
 * A GUARDA de `--yes` protege execução real em worktree. Ela funciona; o que
 * este teste fixa é que ela responde em PROSA mesmo sob `--json` — mesma classe
 * de P1.CLI-JSON-EXIT-CODE.b. Fixado como está, sem afirmar que está certo.
 */
test("ACHADO: a guarda de `--yes` ignora `--json` e responde em prosa", (t) => {
  const cwd = sandbox(t)
  comPlano(cwd, "p2", [{ id: "s1", title: "noop", command: "node -e 0" }])

  const r = rodar(cwd, ["p2", "--json"])
  assertRodou(r, "sem --yes")
  assert.equal(r.pure, false,
    "comportamento ATUAL, não desejado: consumidor de máquina recebe texto onde espera documento")
})
