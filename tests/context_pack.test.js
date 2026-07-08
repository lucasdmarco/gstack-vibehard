import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const mk = (p) => mkdtempSync(path.join(tmpdir(), p))

test("isSecretPath: .env/secrets/pem/key/token bloqueados; fonte comum ok", async () => {
  const { isSecretPath } = await imp("src/skills/context-pack.js")
  for (const s of [".env", ".env.local", "config/secrets.json", "id_rsa", "cert.pem", "api.key", "auth_token.txt"])
    assert.equal(isSecretPath(s), true, s)
  for (const ok of ["src/App.tsx", "README.md", "lib/parse.js"]) assert.equal(isSecretPath(ok), false, ok)
})

test("buildContextPack: exclui secrets, conta tokens (isEstimate), lista graphSummary", async () => {
  const { buildContextPack } = await imp("src/skills/context-pack.js")
  const pack = buildContextPack({ runId: "r1", objective: "construir dashboard", files: ["src/App.tsx", ".env", "lib/x.js"], graphSummary: { present: true, nodes: 10 } })
  assert.equal(pack.schemaVersion, "gstack.context-pack.v1")
  assert.deepEqual(pack.files, ["src/App.tsx", "lib/x.js"])
  assert.deepEqual(pack.excludedSecrets, [".env"])
  assert.equal(pack.tokenAccounting.isEstimate, true)
  assert.ok(pack.tokenAccounting.estimatedTokens > 0)
  assert.equal(pack.graphSummary.nodes, 10)
})

test("contextPackState: missing → stale (grafo mais novo) → fresh", async () => {
  const { writeContextPack, buildContextPack, contextPackState } = await imp("src/skills/context-pack.js")
  const dir = mk("gstack-cp-state-")
  try {
    assert.equal(contextPackState({ root: dir }).state, "missing")
    writeContextPack({ root: dir, pack: buildContextPack({ objective: "x" }) })
    assert.equal(contextPackState({ root: dir }).state, "fresh")
    // grafo mais novo que o pack → stale
    const gpath = path.join(dir, "graphify-out", "graph.json")
    mkdirSync(path.dirname(gpath), { recursive: true }); writeFileSync(gpath, "{}")
    const future = Date.now() / 1000 + 3600
    utimesSync(gpath, future, future)
    assert.equal(contextPackState({ root: dir }).state, "stale")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("evaluateDoubleContextGuard: paralelo sem pack bloqueia; com pack fresco ok; serial nunca aplica", async () => {
  const { evaluateDoubleContextGuard, generateSharedPack } = await imp("src/skills/context-pack.js")
  const dir = mk("gstack-cp-guard-")
  try {
    assert.equal(evaluateDoubleContextGuard({ root: dir, parallel: false }).applicable, false)
    const blocked = evaluateDoubleContextGuard({ root: dir, parallel: true })
    assert.equal(blocked.ok, false); assert.ok(blocked.requiredAction)
    generateSharedPack({ root: dir, objective: "y" })
    assert.equal(evaluateDoubleContextGuard({ root: dir, parallel: true }).ok, true)
    assert.ok(existsSync(path.join(dir, ".gstack", "context-pack.json")), "pack compartilhado gerado")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
