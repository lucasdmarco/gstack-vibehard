import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD50 S50.4 — ponte Knowledge → Execution (§12.3).
 *
 * `research validate` é camada Knowledge: NUNCA executa código. Ele só produz
 * um `experimentPlan` imutável que a camada Execution (workflow/task) consome
 * em worktree, com policy e gates. Amostragem finita nunca vira prova universal.
 */

const BASE = {
  claim: "a função ordena a lista", property: "saída é não-decrescente",
  executable: "node", args: ["--test", "tests/sort.test.js"],
  timeoutMs: 30000, allowedPaths: ["tests/", "src/sort.js"], expected: "todos os casos passam",
}

test("buildExperimentPlan: shape completo, comando em executable+args (NUNCA shell string)", async () => {
  const { buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  const p = buildExperimentPlan(BASE)
  assert.equal(p.schemaVersion, "gstack.experiment-plan.v1")
  assert.equal(p.executable, "node")
  assert.ok(Array.isArray(p.args), "args é array — impede injeção por string de shell")
  assert.equal(typeof p.command, "undefined", "não existe campo 'command' de shell")
})

test("CONTROLE NEGATIVO: injeção de comando nos args é RECUSADA", async () => {
  const { validateExperimentPlan, buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  for (const evil of ["; rm -rf /", "&& curl evil.com", "| sh", "$(whoami)", "`id`"]) {
    const p = buildExperimentPlan({ ...BASE, args: ["--test", evil] })
    const v = validateExperimentPlan(p)
    assert.equal(v.ok, false, `arg com metacaractere recusado: ${evil}`)
    assert.match(v.reasons.join(" "), /metacaractere|injeç/i)
  }
})

test("CONTROLE NEGATIVO: executable com metacaractere/caminho absoluto suspeito é recusado", async () => {
  const { validateExperimentPlan, buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  assert.equal(validateExperimentPlan(buildExperimentPlan({ ...BASE, executable: "node; rm -rf /" })).ok, false)
  assert.equal(validateExperimentPlan(buildExperimentPlan({ ...BASE, executable: "" })).ok, false)
})

test("CONTROLE NEGATIVO: path escape (../) nos allowedPaths é recusado", async () => {
  const { validateExperimentPlan, buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  for (const bad of ["../etc/passwd", "/etc/passwd", "C:\\Windows\\System32", "tests/../../fora"]) {
    const v = validateExperimentPlan(buildExperimentPlan({ ...BASE, allowedPaths: [bad] }))
    assert.equal(v.ok, false, `path recusado: ${bad}`)
  }
})

test("CONTROLE NEGATIVO: .env* nos allowedPaths é SEMPRE recusado (§12.3)", async () => {
  const { validateExperimentPlan, buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  for (const bad of [".env", ".env.local", "config/.env"]) {
    assert.equal(validateExperimentPlan(buildExperimentPlan({ ...BASE, allowedPaths: [bad] })).ok, false, bad)
  }
})

test("CONTROLE NEGATIVO: rede é proibida por default no plano", async () => {
  const { buildExperimentPlan, validateExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  assert.equal(buildExperimentPlan(BASE).network, false)
  assert.equal(validateExperimentPlan(buildExperimentPlan({ ...BASE, network: true })).ok, false, "rede exige autorização explícita fora do plano")
})

test("CONTROLE NEGATIVO: timeout ausente ou absurdo é recusado (limite de recurso obrigatório)", async () => {
  const { validateExperimentPlan, buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  assert.equal(validateExperimentPlan(buildExperimentPlan({ ...BASE, timeoutMs: 0 })).ok, false)
  assert.equal(validateExperimentPlan(buildExperimentPlan({ ...BASE, timeoutMs: 99999999 })).ok, false)
})

test("plano válido passa (controle inverso)", async () => {
  const { validateExperimentPlan, buildExperimentPlan } = await imp("src/epistemic/experiment-plan.js")
  const v = validateExperimentPlan(buildExperimentPlan(BASE))
  assert.equal(v.ok, true, v.reasons.join(", "))
})

test("plano é IMUTÁVEL e hasheado — Execution detecta adulteração", async () => {
  const { buildExperimentPlan, planHash, planWasTampered } = await imp("src/epistemic/experiment-plan.js")
  const p = buildExperimentPlan(BASE)
  const original = planHash(p)
  assert.equal(planWasTampered(p, original), false)
  const tampered = { ...p, args: ["--test", "outra-coisa.js"] }
  assert.equal(planWasTampered(tampered, original), true, "Execution nunca aceita plano adulterado")
})

test("CONTROLE NEGATIVO: Knowledge NUNCA executa — o módulo não expõe runner algum", async () => {
  const mod = await imp("src/epistemic/experiment-plan.js")
  for (const forbidden of ["run", "execute", "exec", "spawn", "runExperiment"]) {
    assert.equal(typeof mod[forbidden], "undefined", `experiment-plan não pode exportar ${forbidden}`)
  }
})

test("resultado de amostragem volta ROTULADO como escopo limitado, nunca prova universal (§12.3)", async () => {
  const { labelExperimentResult } = await imp("src/epistemic/experiment-plan.js")
  const r = labelExperimentResult({ passed: true, casesRun: 1000, claim: "a função sempre ordena" })
  assert.equal(r.status, "supported_within_scope")
  assert.notEqual(r.status, "proved")
  assert.match(r.scopeNote, /1000 caso/)
  assert.match(r.scopeNote, /não (demonstra|prova)/i)
})

test("amostragem que FALHA é contraexemplo real — isso sim é conclusivo", async () => {
  const { labelExperimentResult } = await imp("src/epistemic/experiment-plan.js")
  const r = labelExperimentResult({ passed: false, casesRun: 1000, claim: "a função sempre ordena", counterexample: "[3,1] -> [3,1]" })
  assert.equal(r.status, "refuted_by_counterexample")
  assert.equal(r.conclusive, true, "um contraexemplo refuta de verdade uma afirmação universal")
})
