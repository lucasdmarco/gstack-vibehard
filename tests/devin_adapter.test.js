import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("adapter-matrix: devin presente com enforcement real_hooks e riscos honestos", async () => {
  const { getAdapterInfo } = await imp("src/agents/adapter-matrix.js")
  const d = getAdapterInfo("devin")
  assert.equal(d.enforcement, "real_hooks")
  assert.equal(d.generated, true)
  assert.ok(d.riskNotes.some((n) => /downgrade/.test(n)), "downgrade honesto declarado")
  assert.ok(d.riskNotes.some((n) => /cloud handoff/i.test(n)), "risco de cloud declarado")
})

test("detector: getHarness('devin') resolve config por SO + projeto .devin", async () => {
  const { getHarness } = await imp("src/harness/detector.js")
  const h = getHarness("devin")
  assert.equal(h.label, "Devin CLI")
  assert.ok(h.configFile.endsWith(path.join("devin", "config.json")))
  const expectSeg = process.platform === "win32" ? "devin" : path.join(".config", "devin")
  assert.ok(h.configDir.includes(expectSeg))
})

test("generateDevinAssets: gera config(policy)+hooks+3 skills; skill de alto risco é user-triggered", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-devin-"))
  try {
    const { generateDevinAssets } = await imp("src/harness/devin.js")
    const r = generateDevinAssets(cwd, { cwd })
    assert.ok(r.written.some((p) => p.endsWith("config.json")))
    assert.ok(r.written.some((p) => p.endsWith("hooks.v1.json")))
    const config = JSON.parse(await readFile(path.join(cwd, ".devin", "config.json"), "utf-8"))
    // permissões vêm da policy default (deny inclui Exec(sudo))
    assert.ok(config.permissions.deny.includes("Exec(sudo)"))
    assert.ok(Array.isArray(config.permissions.allow))
    const hooks = JSON.parse(await readFile(path.join(cwd, ".devin", "hooks.v1.json"), "utf-8"))
    assert.match(hooks.PreToolUse[0].hooks[0].command, /gstack_vibehard challenge classify/)
    assert.match(hooks.PostToolUse[0].hooks[0].command, /gstack_vibehard audit status/)
    // skills
    for (const s of ["gstack-context", "gstack-verify", "gstack-review"]) {
      assert.ok(existsSync(path.join(cwd, ".devin", "skills", s, "SKILL.md")), `skill ${s}`)
    }
    const review = await readFile(path.join(cwd, ".devin", "skills", "gstack-review", "SKILL.md"), "utf-8")
    assert.match(review, /triggers: \[user\]/, "alto risco não auto-dispara")
    const ctx = await readFile(path.join(cwd, ".devin", "skills", "gstack-context", "SKILL.md"), "utf-8")
    assert.doesNotMatch(ctx, /triggers: \[user\]/, "skill comum auto-carrega")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("generateDevinAssets: compila a policy EFETIVA do projeto (exceção local entra)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-devin-"))
  try {
    await mkdir(path.join(cwd, ".gstack"), { recursive: true })
    await writeFile(path.join(cwd, ".gstack", "policy.json"), JSON.stringify({ permissions: { deny: ["Exec(terraform destroy)"], ask: [], allow: [] } }))
    const { generateDevinAssets } = await imp("src/harness/devin.js")
    generateDevinAssets(cwd, { cwd })
    const config = JSON.parse(await readFile(path.join(cwd, ".devin", "config.json"), "utf-8"))
    assert.ok(config.permissions.deny.includes("Exec(terraform destroy)"), "deny do projeto compilado no Devin")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("generateDevinAssets: NUNCA toca config.local.json e faz backup do config pré-existente", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-devin-"))
  try {
    await mkdir(path.join(cwd, ".devin"), { recursive: true })
    await writeFile(path.join(cwd, ".devin", "config.local.json"), JSON.stringify({ secret_ref: "MINHA_KEY" }))
    await writeFile(path.join(cwd, ".devin", "config.json"), JSON.stringify({ permissions: { allow: ["OLD"] }, hooks: {} }))
    const { generateDevinAssets } = await imp("src/harness/devin.js")
    const r = generateDevinAssets(cwd, { cwd })
    // local preservado e listado como skipped
    const local = JSON.parse(await readFile(path.join(cwd, ".devin", "config.local.json"), "utf-8"))
    assert.equal(local.secret_ref, "MINHA_KEY", "config.local.json intocado")
    assert.ok(r.skipped.some((p) => p.endsWith("config.local.json")))
    // config pré-existente foi backupeado
    assert.ok(existsSync(path.join(cwd, ".devin", "config.json.gstack_vibehard.bak")), "backup do config antigo")
    const cfg = JSON.parse(await readFile(path.join(cwd, ".devin", "config.json"), "utf-8"))
    assert.ok(!(cfg.permissions.allow || []).includes("OLD"), "config regenerado da policy")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
