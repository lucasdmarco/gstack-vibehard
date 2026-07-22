import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.4 — decision-presenter: NUNCA decide sozinho (só traduz a decisão real da
// Policy DSL). `deny` nunca é apresentado como opção aprovável. `ask` explica efeito e
// rollback. Ações sensíveis nunca permitem persistir "allow sempre".

test("presentDecision: 'ask' -> mostra ação/alvo/risco/policy + opções (permitir uma vez/negar/detalhes)", async () => {
  const { presentDecision } = await imp("src/policy/decision-presenter.js")
  const { evaluate, DEFAULT_POLICY } = await imp("src/policy/schema.js")
  const evaluation = evaluate(DEFAULT_POLICY, "Write(src/index.js)")
  const r = presentDecision({ action: "editar arquivo", target: "src/index.js", risk: "altera código; rollback via checkpoint", evaluation })
  assert.equal(r.policy.decision, "ask")
  assert.deepEqual(r.choices, ["allow_once", "deny_and_pause", "view_details"])
})

test("presentDecision: 'deny' NUNCA é apresentado como opção aprovável — sem allow_once nas escolhas (DoD)", async () => {
  const { presentDecision } = await imp("src/policy/decision-presenter.js")
  const evaluation = { decision: "deny", rule: "Write(.env*)" }
  const r = presentDecision({ action: "escrever .env", target: ".env", risk: "vazamento de segredo", evaluation })
  assert.ok(!r.choices.includes("allow_once"), "deny nunca oferece allow_once")
  assert.deepEqual(r.choices, ["acknowledge_denied", "view_details"])
})

test("presentDecision: 'allow' -> segue direto (proceed), sem perguntar à toa", async () => {
  const { presentDecision } = await imp("src/policy/decision-presenter.js")
  const evaluation = { decision: "allow", rule: "Read(**)" }
  const r = presentDecision({ action: "ler arquivo", target: "src/index.js", risk: "nenhum", evaluation })
  assert.deepEqual(r.choices, ["proceed"])
})

test("canPersistChoice: categoria sensível (destrutivo/secret/deploy/cloud/rede/fora-do-projeto) NUNCA permite 'permitir sempre' (DoD)", async () => {
  const { canPersistChoice, SENSITIVE_CATEGORIES } = await imp("src/policy/decision-presenter.js")
  for (const cat of SENSITIVE_CATEGORIES) assert.equal(canPersistChoice(cat), false, `${cat} nunca persiste`)
  assert.equal(canPersistChoice("read_only"), true)
})

test("presentDecision: schemaVersion estável e nunca inclui o valor de segredo no risco/ação", async () => {
  const { presentDecision, DECISION_PRESENTER_SCHEMA } = await imp("src/policy/decision-presenter.js")
  const r = presentDecision({ action: "x", target: "y", risk: "z", evaluation: { decision: "allow", rule: null } })
  assert.equal(r.schemaVersion, DECISION_PRESENTER_SCHEMA)
})
