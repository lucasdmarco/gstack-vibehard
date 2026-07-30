import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.2.5 (ações #6/#7) — achado que recalibrou o plano: não existe (nem
 * deveria existir) um classificador de "intenção de entrega" — `start` sempre
 * significa "construir/rodar algo" (consulta/planejamento são outros comandos:
 * `consult`/`plan`); `--dry-run` já sai antes de qualquer proof (estrutural).
 * Atrás de `--golden-run`, proof roda por padrão; `--no-proof` é o opt-out.
 */

async function run(cwd, args, extraOpts = {}) {
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

test("start SEM --golden-run e SEM --proof: proof não roda (comportamento legado intacto)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-proof-1-"))
  try {
    const { r, proofCalls } = await run(cwd, [])
    assert.equal(proofCalls, 0)
    assert.equal(r.proof, undefined)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

// PRD51 S51.10.0 refinou esta regra: o proof automático passou a ser condicionado
// à ENTREGA. `exec` injetado não cria projeto real, o motor devolve `handoff`, e
// um handoff não paga proof. O ramo `done` (proof roda) é provado direto em
// tests/golden_run_default.test.js, que exercita `proofShouldRun` nos dois lados.
test("start COM --golden-run em run que NÃO entregou: proof automático é suprimido (handoff não é entrega)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-proof-2-"))
  try {
    const { r, proofCalls } = await run(cwd, ["--golden-run"])
    assert.equal(r.pipeline.status, "handoff", "premissa do teste: exec fake não entrega sob Golden Run")
    assert.equal(proofCalls, 0, "S51.10.0: automático só com entrega real")
    assert.equal(r.proof, undefined)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start COM --golden-run E --no-proof: opt-out explícito respeitado, proof não roda", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-proof-3-"))
  try {
    const { r, proofCalls } = await run(cwd, ["--golden-run", "--no-proof"])
    assert.equal(proofCalls, 0)
    assert.equal(r.proof, undefined)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start COM --proof explícito (sem --golden-run): comportamento opt-in antigo preservado", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-proof-4-"))
  try {
    const { r, proofCalls } = await run(cwd, ["--proof"])
    assert.equal(proofCalls, 1)
    assert.ok(r.proof)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("start --dry-run COM --golden-run: proof NUNCA roda em dry-run (estrutural — ação #7)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-proof-5-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    let proofCalls = 0
    await startCommand(["--dry-run", "--json", "--golden-run"], {
      cwd, objective: "web app", projectName: "app", mode: "lite",
      proofRunner: async () => { proofCalls++; return { ready: true } },
    })
    assert.equal(proofCalls, 0)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
