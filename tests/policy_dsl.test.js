import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("evaluate: precedência deny > allow > ask > default (allow específico bate ask amplo)", async () => {
  const { evaluate } = await imp("src/policy/schema.js")
  const policy = { permissions: {
    deny: ["Write(.env*)", "Exec(rm)"],
    ask: ["Write(**)", "exec"],
    allow: ["Read(**)", "Exec(git status)"],
  } }
  assert.equal(evaluate(policy, "Write(.env)").decision, "deny", "deny vence tudo")
  assert.equal(evaluate(policy, "Write(src/x.js)").decision, "ask", "escrita não-negada/não-allow → ask")
  assert.equal(evaluate(policy, "Exec(rm)").decision, "deny")
  assert.equal(evaluate(policy, "Exec(git status)").decision, "allow", "allow específico auto-aprova apesar do `exec` amplo na ask")
  assert.equal(evaluate(policy, "Exec(git commit)").decision, "ask", "exec não-allowlisted → ask (catch-all)")
  assert.equal(evaluate(policy, "Read(qualquer/coisa)").decision, "allow")
  assert.equal(evaluate(policy, "Fetch(http://x)").decision, "default", "sem regra → default seguro")
})

test("matchTarget: globs ** e *, e mcp namespaced", async () => {
  const { matchTarget, parseTarget } = await imp("src/policy/schema.js")
  assert.equal(matchTarget("Read(**)", parseTarget("Read(a/b/c.js)")), true)
  assert.equal(matchTarget("Write(.env*)", parseTarget("Write(.env.local)")), true)
  assert.equal(matchTarget("Write(.env*)", parseTarget("Write(src/app.js)")), false)
  assert.equal(matchTarget("mcp__github__delete_*", parseTarget("mcp__github__delete_repo")), true)
  assert.equal(matchTarget("mcp__github__list_*", parseTarget("mcp__github__delete_repo")), false)
  assert.equal(matchTarget("mcp__*", parseTarget("mcp__stripe__pay")), true)
})

test("validatePolicy: rejeita segredo embutido (policy versiona padrões, não valores)", async () => {
  const { validatePolicy } = await imp("src/policy/schema.js")
  const clean = { permissions: { allow: ["Read(**)"], deny: [], ask: [] } }
  assert.equal(validatePolicy(clean).valid, true)
  const dirty = { permissions: { allow: ["Read(**)"], deny: [], ask: [] }, note: "token=ghp_" + "a".repeat(40) }
  const v = validatePolicy(dirty)
  assert.equal(v.valid, false)
  assert.ok(v.errors.some((e) => /SEGREDO/.test(e)))
  // ramos de shape inválido (cobertura das guardas)
  assert.deepEqual(validatePolicy(null).errors, ["policy não é objeto"])
  assert.ok(validatePolicy({}).errors.includes("permissions ausente"))
  assert.ok(validatePolicy({ permissions: { allow: "x" } }).errors.some((e) => /allow deve ser array/.test(e)))
  assert.ok(validatePolicy({ permissions: { deny: ["Frobnicate(x)"] } }).errors.some((e) => /não reconhecido/.test(e)))
})

test("compilePolicy: nível HONESTO por enforcement (real_hooks=enforced, instrucional=advisory)", async () => {
  const { compilePolicy } = await imp("src/policy/compiler.js")
  const { DEFAULT_POLICY } = await imp("src/policy/schema.js")
  const claude = compilePolicy(DEFAULT_POLICY, "claude") // real_hooks
  assert.equal(claude.level, "enforced")
  assert.equal(claude.advisory, false)
  assert.equal(claude.artifactKind, "permissions")
  assert.ok(Array.isArray(claude.artifact.permissions.deny))
  const gemini = compilePolicy(DEFAULT_POLICY, "gemini") // instructional
  assert.equal(gemini.level, "advisory")
  assert.equal(gemini.advisory, true, "instrucional NUNCA é enforced")
  assert.equal(gemini.artifactKind, "rules_markdown")
  const unknown = compilePolicy(DEFAULT_POLICY, "inexistente")
  assert.equal(unknown.advisory, true, "harness desconhecido cai em advisory, sem crash")
})

test("layers: default ← policy.json ← policy.local.json; local sobrepõe", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pol-"))
  try {
    await mkdir(path.join(cwd, ".gstack"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "policy.json"), JSON.stringify({ permissions: { deny: ["Exec(rm)"], ask: [], allow: ["Read(**)"] } }))
    await writeFile(path.join(cwd, ".gstack", "policy.local.json"), JSON.stringify({ permissions: { allow: ["Exec(docker ps)"] } }))
    const { loadEffectivePolicy } = await imp("src/policy/layers.js")
    const { policy, layers } = loadEffectivePolicy(cwd)
    assert.deepEqual(layers, ["policy.json", "policy.local.json"])
    assert.ok(policy.permissions.allow.includes("Exec(docker ps)"), "exceção local aplicada")
    assert.ok(policy.permissions.deny.includes("Exec(rm)"), "deny do time preservado")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("localsGitignored: detecta locais fora do .gitignore", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pol-"))
  try {
    const { localsGitignored } = await imp("src/policy/layers.js")
    assert.equal(localsGitignored(cwd).ok, false, "sem .gitignore → não ok")
    await writeFile(path.join(cwd, ".gitignore"), ".gstack/config.local.json\n.gstack/policy.local.json\n")
    assert.equal(localsGitignored(cwd).ok, true)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("policy init: cria policy.json + conserta .gitignore; doctor fica ok", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pol-"))
  try {
    const { policyCommand } = await imp("src/commands/policy.js")
    const init = policyCommand(["init", "--json"], { cwd })
    assert.equal(init.created, true)
    assert.ok(existsSync(path.join(cwd, ".gstack", "policy.json")))
    const gi = await readFile(path.join(cwd, ".gitignore"), "utf-8")
    assert.ok(gi.includes(".gstack/policy.local.json"))
    const doc = policyCommand(["doctor", "--json"], { cwd })
    assert.equal(doc.ok, true)
    assert.equal(doc.valid, true)
    // eval usa a policy efetiva
    const ev = policyCommand(["eval", "Exec(sudo)", "--json"], { cwd })
    assert.equal(ev.decision, "deny")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
