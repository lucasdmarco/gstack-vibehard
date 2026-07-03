import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("modelPolicy default: explore/review=cheap, implement=default, architecture/security=strong", async () => {
  const { DEFAULT_MODEL_POLICY, validateModelPolicy } = await imp("src/model-policy/schema.js")
  const mp = DEFAULT_MODEL_POLICY.modelPolicy
  assert.equal(mp.explore, "cheap")
  assert.equal(mp.review, "cheap")
  assert.equal(mp.implement, "default")
  assert.equal(mp.architecture, "strong")
  assert.equal(mp.security, "strong")
  assert.equal(validateModelPolicy(DEFAULT_MODEL_POLICY).valid, true)
  // shape inválido
  assert.equal(validateModelPolicy({ modelPolicy: { explore: "gpt-5" } }).valid, false, "tier deve ser cheap|default|strong")
  assert.equal(validateModelPolicy({ modelPolicy: { hackear: "cheap" } }).valid, false, "tipo de tarefa desconhecido")
})

test("resolveModel: sem modelo configurado → fallback local_deterministic (nunca exige externo)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mp-"))
  try {
    const { resolveModel } = await imp("src/model-policy/index.js")
    const r = resolveModel(cwd, "explore")
    assert.equal(r.tier, "cheap")
    assert.equal(r.model, null)
    assert.equal(r.fallback, "local_deterministic")
    const sec = resolveModel(cwd, "security")
    assert.equal(sec.tier, "strong")
    assert.equal(sec.fallback, "local_deterministic")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("resolveModel: projeto com model-policy.json e models por tier → usa o do usuário", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mp-"))
  try {
    await mkdir(path.join(cwd, ".gstack"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "model-policy.json"), JSON.stringify({
      modelPolicy: { explore: "cheap", implement: "strong" },
      models: { cheap: "haiku", strong: "opus" },
    }))
    const { resolveModel, loadModelPolicy } = await imp("src/model-policy/index.js")
    assert.equal(loadModelPolicy(cwd).source, "project")
    const ex = resolveModel(cwd, "explore")
    assert.equal(ex.model, "haiku")
    assert.equal(ex.fallback, null)
    const impl = resolveModel(cwd, "implement")
    assert.equal(impl.tier, "strong", "override do usuário respeitado")
    assert.equal(impl.model, "opus")
    // kind não sobrescrito herda o default (review=cheap)
    assert.equal(resolveModel(cwd, "review").model, "haiku")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("model-policy.json inválido/corrompido → cai no default com warning (nunca crash)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mp-"))
  try {
    await mkdir(path.join(cwd, ".gstack"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "model-policy.json"), "{ nao é json")
    const { loadModelPolicy, resolveModel } = await imp("src/model-policy/index.js")
    const l = loadModelPolicy(cwd)
    assert.equal(l.source, "default")
    assert.ok(l.warnings?.length)
    assert.equal(resolveModel(cwd, "explore").tier, "cheap")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("initModelPolicy: cria o arquivo default; idempotente sem --force", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-mp-"))
  try {
    const { initModelPolicy, modelPolicyPath } = await imp("src/model-policy/index.js")
    assert.equal(initModelPolicy(cwd).created, true)
    assert.ok(existsSync(modelPolicyPath(cwd)))
    assert.equal(initModelPolicy(cwd).created, false, "não sobrescreve sem force")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
