import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("credentialStatus: valor ausente -> absent", async () => {
  const { credentialStatus } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.equal(credentialStatus(undefined), "absent")
  assert.equal(credentialStatus(""), "absent")
})

test("credentialStatus: placeholder do scaffold (change-me) NUNCA vira 'present' (DoD)", async () => {
  const { credentialStatus } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.equal(credentialStatus("sk_test_change-me"), "placeholder")
  assert.equal(credentialStatus("change-me"), "placeholder")
})

test("credentialStatus: valor real (nao-placeholder) -> present", async () => {
  const { credentialStatus } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.equal(credentialStatus("a-real-looking-nonplaceholder-credential-value"), "present")
})

test("stripeGate: .env.example do scaffold real (placeholders) -> SEMPRE blocked, nunca verde (DoD linha 6)", async () => {
  const { stripeGate } = await imp("src/project-plan/golden-workflow-vertical.js")
  const env = { STRIPE_SECRET_KEY: "sk_test_change-me", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_change-me" }
  const r = stripeGate(env)
  assert.equal(r.status, "blocked")
  assert.equal(r.missing.length, 2)
})

test("stripeGate: credencial real presente nas DUAS chaves -> eligible", async () => {
  const { stripeGate } = await imp("src/project-plan/golden-workflow-vertical.js")
  const env = { STRIPE_SECRET_KEY: "sk_test_51real", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_51real" }
  assert.equal(stripeGate(env).status, "eligible")
})

test("stripeGate: só UMA das duas chaves real -> ainda blocked (nunca parcialmente verde)", async () => {
  const { stripeGate } = await imp("src/project-plan/golden-workflow-vertical.js")
  const env = { STRIPE_SECRET_KEY: "sk_test_51real", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_change-me" }
  const r = stripeGate(env)
  assert.equal(r.status, "blocked")
  assert.equal(r.missing.length, 1)
})

test("supabaseGate: mesma disciplina fail-closed do stripeGate", async () => {
  const { supabaseGate } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.equal(supabaseGate({}).status, "blocked")
  assert.equal(supabaseGate({ NEXT_PUBLIC_SUPABASE_URL: "https://real.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJreal" }).status, "eligible")
})

test("evidenceItem: id fora da lista das 14 evidencias obrigatorias -> lanca", async () => {
  const { evidenceItem } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.throws(() => evidenceItem("inexistente", "proved"), /evidência desconhecida/)
})

test("evidenceItem: status fora do enum tipado -> lanca (sem meio-termo silencioso)", async () => {
  const { evidenceItem } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.throws(() => evidenceItem("runtime_started", "kinda_ok"), /status de evidência inválido/)
})

test("buildVerticalReport: as 14 evidencias PROVADAS -> overall 'proved' (caminho feliz)", async () => {
  const { evidenceItem, buildVerticalReport, EVIDENCE_IDS } = await imp("src/project-plan/golden-workflow-vertical.js")
  const items = EVIDENCE_IDS.map((id) => evidenceItem(id, "proved"))
  const r = buildVerticalReport(items)
  assert.equal(r.overall, "proved")
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.notProved, [])
})

test("buildVerticalReport: UMA evidencia blocked -> overall 'partial', nunca 'proved' por decreto (DoD)", async () => {
  const { evidenceItem, buildVerticalReport, EVIDENCE_IDS } = await imp("src/project-plan/golden-workflow-vertical.js")
  const items = EVIDENCE_IDS.map((id) => evidenceItem(id, id === "stripe_test_mode" ? "blocked" : "proved"))
  const r = buildVerticalReport(items)
  assert.equal(r.overall, "partial")
  assert.deepEqual(r.notProved, ["stripe_test_mode"])
})

test("buildVerticalReport: evidencia AUSENTE do relatorio -> overall 'partial', listada em missing (nunca some silenciosamente)", async () => {
  const { evidenceItem, buildVerticalReport, EVIDENCE_IDS } = await imp("src/project-plan/golden-workflow-vertical.js")
  const items = EVIDENCE_IDS.filter((id) => id !== "rollback_to_green").map((id) => evidenceItem(id, "proved"))
  const r = buildVerticalReport(items)
  assert.equal(r.overall, "partial")
  assert.deepEqual(r.missing, ["rollback_to_green"])
})

test("EVIDENCE_IDS: exatamente as 14 evidencias obrigatorias do DoD do sprint 47.9", async () => {
  const { EVIDENCE_IDS } = await imp("src/project-plan/golden-workflow-vertical.js")
  assert.equal(EVIDENCE_IDS.length, 14)
})
