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

// PRD51 S51.7.2 — `canPersistChoice` recebia uma CATEGORIA, mas nada no repo
// derivava categoria de um alvo real: a função era inalcançável fora de teste.
test("categorizeTarget: deriva categoria SENSÍVEL de alvos reais (secret/destructive/deploy/rede/mcp)", async () => {
  const { categorizeTarget, canPersistChoice } = await imp("src/policy/decision-presenter.js")
  const { parseTarget } = await imp("src/policy/schema.js")
  const cat = (t) => categorizeTarget(parseTarget(t))
  assert.equal(cat("Write(.env)"), "secret")
  assert.equal(cat("Write(apps/api/.env.local)"), "secret")
  assert.equal(cat("Exec(rm -rf build)"), "destructive")
  assert.equal(cat("Exec(npm publish)"), "deploy")
  assert.equal(cat("Exec(git push origin main)"), "network_sensitive")
  assert.equal(cat("mcp__github__create_issue"), "cloud_handoff")
  // toda categoria derivada acima é sensível ⇒ nunca vira "permitir sempre"
  for (const t of ["Write(.env)", "Exec(rm -rf build)", "Exec(npm publish)", "Exec(git push origin main)", "mcp__github__create_issue"]) {
    assert.equal(canPersistChoice(cat(t)), false, `${t} nunca persiste`)
  }
})

test("categorizeTarget: alvo comum NÃO vira sensível por engano (read_only/standard podem persistir)", async () => {
  const { categorizeTarget, canPersistChoice } = await imp("src/policy/decision-presenter.js")
  const { parseTarget } = await imp("src/policy/schema.js")
  const cat = (t) => categorizeTarget(parseTarget(t))
  assert.equal(cat("Read(src/index.js)"), "read_only")
  assert.equal(cat("Write(src/index.js)"), "standard")
  assert.equal(cat("Exec(npm run build)"), "standard")
  assert.equal(canPersistChoice(cat("Read(src/index.js)")), true)
  assert.equal(canPersistChoice(cat("Write(src/index.js)")), true)
})

// O wiring REAL: `policy eval` é a superfície onde um humano vê uma decisão.
test("policy eval --json: inclui o presenter REAL (nunca só o veredito solto) — S51.7.2", async () => {
  const { policyCommand } = await imp("src/commands/policy.js")
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { policyCommand(["eval", "Write(.env)", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const out = JSON.parse(buf.trim())
  assert.equal(out.decision, "deny")
  assert.equal(out.presenter.schemaVersion, "gstack.decision-presenter.v1")
  assert.equal(out.presenter.category, "secret")
  assert.equal(out.presenter.canPersist, false, "categoria sensível nunca vira preferência persistida")
  assert.ok(!out.presenter.choices.includes("allow_once"), "deny NUNCA oferece allow_once")
})

test("policy eval --json: alvo que exige confirmação apresenta as 3 escolhas seguras", async () => {
  const { policyCommand } = await imp("src/commands/policy.js")
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += s; return true }
  try { policyCommand(["eval", "Write(src/index.js)", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const out = JSON.parse(buf.trim())
  assert.equal(out.decision, "ask")
  assert.deepEqual(out.presenter.choices, ["allow_once", "deny_and_pause", "view_details"])
  assert.equal(out.presenter.canPersist, true, "alvo comum (standard) pode virar preferência")
})
