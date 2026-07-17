import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.3 (P1.5) — o journal de replay persistia segredo em campos não literais. O
// `appendEvent` só apagava as chaves EXATAS `secret` e `transcript` no top-level: um token em
// `task`, `summary`, `signature`, aninhado em objeto/array ou embutido em URL era gravado em
// .gstack/workflows/runs/*/journal.jsonl. Correção: redação RECURSIVA compartilhada antes de
// qualquer escrita, com limites de profundidade/tamanho, reusando o redactSecrets já existente.

const redactMod = path.resolve(import.meta.dirname, "..", "src", "workflow-graph", "redact-event.js")
const journalMod = path.resolve(import.meta.dirname, "..", "src", "workflow-graph", "journal.js")
const imp = (m) => import(`${pathToFileURL(m)}?t=${Date.now()}`)

const GH = "ghp_" + "A".repeat(36) // casa o padrão do redactSecrets

test("redação recursiva: segredo em chave sensível por NOME é mascarado (não só `secret`)", async () => {
  const { redactEvent } = await imp(redactMod)
  const r = redactEvent({ event: "node_completed", token: "abc123def456", apiKey: "zzzz-secret-value", password: "hunter2xx" })
  assert.notEqual(r.token, "abc123def456", "chave `token` mascarada")
  assert.notEqual(r.apiKey, "zzzz-secret-value", "chave `apiKey` mascarada")
  assert.notEqual(r.password, "hunter2xx", "chave `password` mascarada")
  assert.equal(r.event, "node_completed", "campos não-sensíveis preservados")
})

test("redação recursiva: segredo por PADRÃO em valor de texto livre (task/summary/URL)", async () => {
  const { redactEvent } = await imp(redactMod)
  const r = redactEvent({
    event: "node_started",
    task: `deploy usando ${GH} agora`,
    summary: "ok",
    url: `https://x.com/cb?token=${GH}`,
  })
  assert.ok(!String(r.task).includes(GH), "CONTROLE NEGATIVO: token em texto livre não persiste")
  assert.ok(!String(r.url).includes(GH), "token na URL redigido")
  assert.equal(r.summary, "ok")
})

test("redação recursiva: objeto/array ANINHADOS são varridos", async () => {
  const { redactEvent } = await imp(redactMod)
  const r = redactEvent({
    event: "x",
    meta: { nested: { token: "supersecretvalue" }, list: [`k=${GH}`, "safe"] },
  })
  assert.notEqual(r.meta.nested.token, "supersecretvalue", "objeto aninhado varrido")
  assert.ok(!String(r.meta.list[0]).includes(GH), "array aninhado varrido")
  assert.equal(r.meta.list[1], "safe")
})

test("chaves literais legadas (secret/transcript) seguem removidas por completo", async () => {
  const { redactEvent } = await imp(redactMod)
  const r = redactEvent({ event: "x", secret: "s", transcript: "t", keep: 1 })
  assert.equal(r.secret, undefined, "secret removido")
  assert.equal(r.transcript, undefined, "transcript removido")
  assert.equal(r.keep, 1)
})

test("limites: profundidade e tamanho de string são bounded (journal não explode)", async () => {
  const { redactEvent } = await imp(redactMod)
  // objeto muito profundo não pode causar recursão infinita nem persistir tudo.
  let deep = { v: 1 }
  for (let i = 0; i < 50; i++) deep = { child: deep }
  const r = redactEvent({ event: "x", deep, big: "y".repeat(10000) })
  assert.ok(JSON.stringify(r).length < 20000, "evento redigido é bounded")
  assert.ok(String(r.big).length < 10000, "string longa é truncada")
  assert.ok(String(r.big).endsWith("[truncated]"), "marca de truncamento presente")
})

test("não muta o objeto de entrada (redação retorna cópia)", async () => {
  const { redactEvent } = await imp(redactMod)
  const input = { event: "x", token: "secretsecret" }
  redactEvent(input)
  assert.equal(input.token, "secretsecret", "entrada original intacta")
})

test("INTEGRAÇÃO: appendEvent grava journal SEM o segredo (em qualquer campo)", async () => {
  const { appendEvent, readJournal } = await imp(journalMod)
  const base = await mkdtemp(path.join(tmpdir(), "gstack-journal-"))
  try {
    appendEvent(base, "run1", { event: "node_started", nodeId: "worker#1", task: `use ${GH}`, note: { apiKey: "abc12345xyz" } })
    const raw = await readFile(path.join(base, "run1", "journal.jsonl"), "utf-8")
    assert.ok(!raw.includes(GH), "CONTROLE NEGATIVO: token não está no arquivo do journal")
    assert.ok(!raw.includes("abc12345xyz"), "segredo aninhado não está no arquivo")
    const evs = readJournal(base, "run1")
    assert.equal(evs[0].nodeId, "worker#1", "metadados legítimos preservados")
  } finally { await rm(base, { recursive: true, force: true }) }
})
