import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

const FAKE_TOKEN = "ghp_" + "z9y8x7w6v5u4z9y8x7w6v5u4z9y8x7w6v5u4"

test("state store: grava e lê por entidade; summary conta por entidade", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-"))
  try {
    const { openStateStore } = await imp("src/state/store.js")
    const store = openStateStore(dir)
    store.record("workflow_runs", { runId: "r1", status: "done" })
    store.record("workflow_runs", { runId: "r2", status: "failed" })
    store.record("decisions", { decision: "usar sqlite" })

    const runs = store.list("workflow_runs")
    assert.equal(runs.length, 2)
    assert.equal(runs[0].runId, "r2", "mais recente primeiro")

    const s = store.summary()
    assert.equal(s.entities.workflow_runs.count, 2)
    assert.equal(s.entities.decisions.count, 1)
    assert.equal(s.entities.sessions.count, 0)
    assert.ok(["sqlite", "jsonl_fallback"].includes(s.backend), "backend declarado")
    store.close()
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("state store: NUNCA grava secret — chave proibida some, valor com token é redigido", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-"))
  try {
    const { openStateStore } = await imp("src/state/store.js")
    const store = openStateStore(dir)
    const written = store.record("governance_events", {
      event: "install",
      api_key: "super-secreto-123",            // chave proibida → removida
      GH_TOKEN: "outro-segredo",               // chave proibida → removida
      note: `commit com ${FAKE_TOKEN} embutido`, // valor com secret → redigido
      transcript: "x".repeat(9000),            // proibida (transcript) → removida
    })
    assert.ok(!("api_key" in written) && !("GH_TOKEN" in written) && !("transcript" in written))
    assert.match(written.note, /\*\*\*REDACTED\*\*\*/)
    store.close()
    // e no ARQUIVO também não há segredo
    const file = store.file
    const raw = await readFile(file, existsSync(file) ? undefined : "utf-8").then((b) => b.toString("utf-8"))
    assert.ok(!raw.includes("super-secreto-123"))
    assert.ok(!raw.includes(FAKE_TOKEN.slice(4)))
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("state store: valor gigante é truncado (anti-transcript)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-"))
  try {
    const { openStateStore } = await imp("src/state/store.js")
    const store = openStateStore(dir)
    const written = store.record("sessions", { output: "a".repeat(50000) })
    assert.ok(written.output.length < 2100, "truncado em ~2000 chars")
    assert.match(written.output, /\[truncado\]/)
    store.close()
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("state store: entidade desconhecida é rejeitada (schema fechado)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-"))
  try {
    const { openStateStore } = await imp("src/state/store.js")
    const store = openStateStore(dir)
    assert.throws(() => store.record("tabela_inventada", { a: 1 }), /entidade desconhecida/)
    store.close()
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("GSTACK_AGENT_DATA_HOME isola a memória por harness (env vence o default)", async () => {
  const proj = await mkdtemp(path.join(tmpdir(), "gstack-state-proj-"))
  const custom = await mkdtemp(path.join(tmpdir(), "gstack-state-home-"))
  try {
    const { openStateStore, resolveDataHome } = await imp("src/state/store.js")
    assert.equal(resolveDataHome(proj, {}), path.join(proj, ".gstack"), "default project-scoped")
    assert.equal(resolveDataHome(proj, { GSTACK_AGENT_DATA_HOME: custom }), custom)

    const store = openStateStore(proj, { env: { GSTACK_AGENT_DATA_HOME: custom } })
    store.record("sessions", { harness: "cursor" })
    store.close()
    assert.ok(store.file.startsWith(custom), "estado foi para o data home custom")
    assert.ok(!existsSync(path.join(proj, ".gstack", "state.db")) && !existsSync(path.join(proj, ".gstack", "state.jsonl")),
      "nada escrito no default quando env aponta para outro lugar")
  } finally {
    await rm(proj, { recursive: true, force: true, maxRetries: 5 })
    await rm(custom, { recursive: true, force: true, maxRetries: 5 })
  }
})

test("fallback JSONL: mesma API, degradação DECLARADA", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-"))
  try {
    const { openStateStore } = await imp("src/state/store.js")
    const store = openStateStore(dir, { forceJsonl: true })
    assert.equal(store.backend, "jsonl_fallback")
    store.record("work_items", { title: "item 1" })
    assert.equal(store.list("work_items")[0].title, "item 1")
    assert.equal(store.summary().entities.work_items.count, 1)
    store.close()
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("store é ADITIVO: não toca journals existentes (.gstack/plans)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-"))
  try {
    const planDir = path.join(dir, ".gstack", "plans", "p1")
    await mkdir(planDir, { recursive: true })
    const journal = path.join(planDir, "journal.jsonl")
    await writeFile(journal, '{"event":"run_started"}\n')
    const { openStateStore } = await imp("src/state/store.js")
    const store = openStateStore(dir)
    store.record("workflow_runs", { runId: "p1", status: "done" })
    store.close()
    assert.equal(await readFile(journal, "utf-8"), '{"event":"run_started"}\n', "journal intocado")
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test("executor grava resumo do run no state store (produtor real, best-effort)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gstack-state-exec-"))
  try {
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { executePlan } = await imp("src/project-plan/executor.js")
    const { openStateStore } = await imp("src/state/store.js")
    const { plan } = buildPlan({ objective: "web app", projectName: "loja" })
    const planDir = path.join(dir, ".gstack", "plans", plan.id)
    executePlan({ plan, planDir, cwd: dir, exec: () => {} })
    const store = openStateStore(dir)
    const runs = store.list("workflow_runs")
    store.close()
    assert.equal(runs.length, 1)
    assert.equal(runs[0].runId, plan.id)
    assert.equal(runs[0].status, "done")
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }) }
})
