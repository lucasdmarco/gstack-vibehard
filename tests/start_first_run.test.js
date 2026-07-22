import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// PRD48 S48.1 — first-run: escolhe harness/modelo real ANTES de reservar budget/Golden Run.
// Nunca decide sozinho com >1 apto; nunca promove modelo inexistente; --yes nunca escolhe
// harness/modelo desconhecido; nenhuma config global/OAuth/secret é tocada.

test("decideFirstRun: nenhum harness apto e tarefa exige LLM -> blocked, nunca inventa executor", async () => {
  const { decideFirstRun } = await imp("src/onboarding/first-run.js")
  const r = decideFirstRun({ profiles: [], requiresLlm: true })
  assert.equal(r.status, "blocked")
  assert.match(r.reason, /nenhum executor apto/)
})

test("decideFirstRun: nenhum harness apto mas tarefa NÃO exige LLM -> local_deterministic (scout/gates)", async () => {
  const { decideFirstRun } = await imp("src/onboarding/first-run.js")
  const r = decideFirstRun({ profiles: [], requiresLlm: false })
  assert.equal(r.status, "local_deterministic")
})

test("decideFirstRun: exatamente UM harness apto -> auto_selected, sem perguntar", async () => {
  const { decideFirstRun } = await imp("src/onboarding/first-run.js")
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const profiles = [buildHarnessSessionProfile("claude", { installed: true, callable: true, enforcement: "native_enforced" })]
  const r = decideFirstRun({ profiles, requiresLlm: true })
  assert.equal(r.status, "auto_selected")
  assert.equal(r.harness, "claude")
})

test("decideFirstRun: MAIS de um harness apto -> ask_user, NUNCA decide sozinho (DoD)", async () => {
  const { decideFirstRun } = await imp("src/onboarding/first-run.js")
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const profiles = [
    buildHarnessSessionProfile("claude", { installed: true, callable: true, enforcement: "native_enforced" }),
    buildHarnessSessionProfile("codex", { installed: true, callable: true, enforcement: "adapter_enforced" }),
  ]
  const r = decideFirstRun({ profiles, requiresLlm: true })
  assert.equal(r.status, "ask_user")
  assert.deepEqual(r.options.sort(), ["claude", "codex"])
})

test("applyFirstRunChoice: escolha VÁLIDA (dentre os aptos) -> selected", async () => {
  const { applyFirstRunChoice } = await imp("src/onboarding/first-run.js")
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const profiles = [buildHarnessSessionProfile("codex", { installed: true, callable: true, enforcement: "adapter_enforced" })]
  const r = applyFirstRunChoice(profiles, "codex")
  assert.equal(r.status, "selected")
  assert.equal(r.harness, "codex")
})

test("applyFirstRunChoice: escolha de harness NÃO apto (ou --yes tentando 'auto' sem opção única) -> rejected, nunca aceita silenciosamente", async () => {
  const { applyFirstRunChoice } = await imp("src/onboarding/first-run.js")
  const { buildHarnessSessionProfile } = await imp("src/onboarding/harness-session-profile.js")
  const profiles = [buildHarnessSessionProfile("codex", { installed: false, callable: false, enforcement: null })]
  const r = applyFirstRunChoice(profiles, "codex")
  assert.equal(r.status, "rejected")
})

test("buildLocalProfileUpdate: preferência só é preparada COM consentimento explícito (nunca por --yes silencioso)", async () => {
  const { buildLocalProfileUpdate } = await imp("src/onboarding/first-run.js")
  const withoutConsent = buildLocalProfileUpdate({ preferredHarness: "codex", consent: false })
  assert.equal(withoutConsent, null, "sem consentimento explícito, nada é preparado pra salvar")
  const withConsent = buildLocalProfileUpdate({ preferredHarness: "codex", consent: true })
  assert.equal(withConsent.preferredHarness, "codex")
  assert.equal(withConsent.schemaVersion, "gstack.local-profile.v1")
})

test("buildLocalProfileUpdate: NUNCA carrega token/secret/OAuth (só enums bounded)", async () => {
  const { buildLocalProfileUpdate } = await imp("src/onboarding/first-run.js")
  const r = buildLocalProfileUpdate({ preferredHarness: "codex", preferredModel: "auto", consent: true })
  const keys = Object.keys(r)
  assert.ok(!keys.some((k) => /token|secret|key|oauth|password/i.test(k)), "nenhuma chave sensível no perfil local")
})
