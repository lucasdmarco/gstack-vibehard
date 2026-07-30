import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.10.0 — o §11 do prd51.md adia "flipar o default de `--golden-run` e
 * remover o código legado" para decisão humana explícita ANTES do RC. O Sprint
 * 51.10 é o RC e a decisão foi tomada: default vira ON, legado PRESERVADO atrás
 * de `--no-golden-run`.
 *
 * Este arquivo é o controle negativo do flip. Prova as duas direções — que o
 * default mudou de verdade E que o escape hatch devolve o caminho antigo
 * inteiro — porque um flip que não pode ser desfeito não é um flip, é uma
 * remoção (e remover o legado é decisão separada, fora desta leva).
 */

async function runStart(cwd, args, extraOpts = {}) {
  const { startCommand } = await imp("src/commands/start.js")
  let proofCalls = 0
  const r = await startCommand(args, {
    cwd, objective: "web app", projectName: "app", mode: "lite", designSystem: "none",
    confirm: async () => true, exec: () => {},
    proofRunner: async () => { proofCalls++; return { ready: true } },
    ...extraOpts,
  })
  return { r, proofCalls }
}

test("default do resolver é ON — `start` sem nenhuma flag governa pelo Golden Run", async () => {
  const { wantsGoldenRun } = await imp("src/commands/start.js")
  assert.equal(wantsGoldenRun({}, {}), true, "S51.10.0: default flipado, sem flag = golden run")
})

test("`--no-golden-run` devolve o caminho legado (escape hatch da decisão do §11)", async () => {
  const { wantsGoldenRun } = await imp("src/commands/start.js")
  assert.equal(wantsGoldenRun({ noGoldenRun: true }, {}), false)
})

test("opt-out programático (`opts.goldenRun === false`) vence o default — sem isso, chamador embutido não teria escape", async () => {
  const { wantsGoldenRun } = await imp("src/commands/start.js")
  assert.equal(wantsGoldenRun({}, { goldenRun: false }), false)
})

test("`GSTACK_GOLDEN_RUN=0` desliga; `=1` liga; ausência cai no default ON", async () => {
  const { wantsGoldenRun } = await imp("src/commands/start.js")
  const prev = process.env.GSTACK_GOLDEN_RUN
  try {
    process.env.GSTACK_GOLDEN_RUN = "0"
    assert.equal(wantsGoldenRun({}, {}), false, "env opt-out respeitado")
    process.env.GSTACK_GOLDEN_RUN = "1"
    assert.equal(wantsGoldenRun({}, {}), true)
    delete process.env.GSTACK_GOLDEN_RUN
    assert.equal(wantsGoldenRun({}, {}), true, "sem env, default ON")
  } finally {
    if (prev === undefined) delete process.env.GSTACK_GOLDEN_RUN
    else process.env.GSTACK_GOLDEN_RUN = prev
  }
})

test("opt-out explícito vence mesmo com `--golden-run` junto — precedência é do opt-out, nunca ambígua", async () => {
  const { wantsGoldenRun } = await imp("src/commands/start.js")
  assert.equal(wantsGoldenRun({ goldenRun: true, noGoldenRun: true }, {}), false)
})

/**
 * Efeito real do flip no `start`, ponta a ponta: sem NENHUMA flag, o pipeline
 * passa a ser julgado pelo motor. Um run de `exec` injetado não cria projeto e
 * não resolve acceptance, então o veredito honesto é `handoff` — onde o legado
 * dizia `done`. É a mudança de comportamento que o flip entrega, e a mesma
 * chamada com `--no-golden-run` (teste seguinte) ainda devolve `done`.
 */
test("efeito real no `start`: sem nenhuma flag, o veredito passa a ser do motor (handoff onde o legado dizia done)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-grdefault-1-"))
  try {
    const { r, proofCalls } = await runStart(cwd, [])
    assert.equal(r.pipeline.status, "handoff", "default: motor exige os 4 portões")
    assert.equal(proofCalls, 0, "não entregou, não paga proof (regra do S51.10.0)")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("mesma chamada com `--no-golden-run` ainda devolve `done` — o legado não foi removido, só deixou de ser default", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-grdefault-1b-"))
  try {
    const { r } = await runStart(cwd, ["--no-golden-run"])
    assert.equal(r.pipeline.status, "done", "escape hatch preserva a semântica solta antiga")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("efeito real do escape hatch: `--no-golden-run` volta o proof a opt-in (legado intacto)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-grdefault-2-"))
  try {
    const { r, proofCalls } = await runStart(cwd, ["--no-golden-run"])
    assert.equal(proofCalls, 0, "legado alcançável: proof não roda sem --proof")
    assert.equal(r.proof, undefined)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

/**
 * S51.10.0 — defeito real que só apareceu quando o proof virou default: um run
 * que terminou em `handoff` pagava um proof completo. Handoff não é entrega.
 */
test("proof automático NÃO roda quando o pipeline não entregou (status handoff)", async () => {
  const { proofShouldRun } = await imp("src/commands/start.js")
  assert.equal(proofShouldRun({}, {}, { status: "handoff" }), false)
  assert.equal(proofShouldRun({}, {}, { status: "done" }), true, "entregou: roda")
})

test("`--proof` explícito roda mesmo em handoff — a intenção é do usuário, não do heurístico", async () => {
  const { proofShouldRun } = await imp("src/commands/start.js")
  assert.equal(proofShouldRun({ proof: true }, {}, { status: "handoff" }), true)
})

test("`--no-proof` continua vencendo o automático mesmo com entrega", async () => {
  const { proofShouldRun } = await imp("src/commands/start.js")
  assert.equal(proofShouldRun({ noProof: true }, {}, { status: "done" }), false)
})

/**
 * S51.10.0 — segundo defeito real destapado pelo flip, este ANTERIOR a ele:
 * `executor.js` marcava o plano como `done` quando os passos de create passavam,
 * enquanto o veredito do pipeline morava noutro arquivo. `plan status` podia
 * afirmar entrega para um run que terminou em handoff.
 */
test("`plan status` reflete o veredito do pipeline, não o sucesso dos passos de create", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-grdefault-4-"))
  try {
    const { readState } = await imp("src/project-plan/state.js")
    const { r } = await runStart(cwd, [])
    assert.equal(r.pipeline.status, "handoff")
    const st = readState(path.join(cwd, ".gstack", "plans", r.plan.id))
    assert.equal(st.status, "handoff", "plano não pode dizer done quando o pipeline deu handoff")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("`--no-golden-run --proof`: os dois opt-outs são independentes — legado no pipeline, proof ligado à mão", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-grdefault-3-"))
  try {
    const { proofCalls } = await runStart(cwd, ["--no-golden-run", "--proof"])
    assert.equal(proofCalls, 1)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
