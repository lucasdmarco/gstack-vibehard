import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("classifyAgent: role default; router/pack por kind ou sufixo", async () => {
  const { classifyAgent } = await imp("src/skills/agents-canonical.js")
  assert.equal(classifyAgent({ id: "backend-dev" }), "role")
  assert.equal(classifyAgent({ id: "meta-router" }), "router")
  assert.equal(classifyAgent({ id: "x", kind: "router" }), "router")
  assert.equal(classifyAgent({ id: "web-pack" }), "pack")
  assert.equal(classifyAgent({ id: "y", kind: "pack" }), "pack")
})

test("buildCanonicalContract: conta papéis MEDIDO, exclui routers/packs, aliases", async () => {
  const { buildCanonicalContract, AGENTS_CANONICAL_SCHEMA } = await imp("src/skills/agents-canonical.js")
  const c = buildCanonicalContract([
    { id: "backend-dev" }, { id: "frontend-dev" }, { id: "meta-router" }, { id: "starter-pack" },
  ])
  assert.equal(c.schemaVersion, AGENTS_CANONICAL_SCHEMA)
  assert.equal(c.count, 2)
  assert.deepEqual(c.canonicalRoles, ["backend-dev", "frontend-dev"])
  assert.deepEqual(c.excluded.routers, ["meta-router"])
  assert.deepEqual(c.excluded.packs, ["starter-pack"])
  assert.equal(c.aliases["backend-dev"], "backend-dev")
})

test("findOrphans: papel sem adapter e adapter sem papel", async () => {
  const { buildCanonicalContract, findOrphans } = await imp("src/skills/agents-canonical.js")
  const c = buildCanonicalContract([{ id: "a" }, { id: "b" }])
  const o = findOrphans(c, ["a", "ghost"])
  assert.deepEqual(o.rolesWithoutAdapter, ["b"], "b não tem adapter")
  assert.deepEqual(o.adaptersWithoutRole, ["ghost"], "ghost não tem papel")
})

test("agents list --canonical (real): conta papéis do repo e escreve .gstack/agents", async () => {
  const { agentsCommand } = await imp("src/commands/agents.js")
  // captura stdout do --json
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await agentsCommand(["list", "--canonical", "--json"], {}) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.agents-canonical.v1")
  assert.ok(parsed.count >= 15, `esperado muitos papéis, veio ${parsed.count}`)
})
