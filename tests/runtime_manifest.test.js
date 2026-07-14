import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "runtime", "manifest.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("tokenizeCommand: string → argv (respeita aspas) e array passa direto", async () => {
  const { tokenizeCommand } = await imp()
  assert.deepEqual(tokenizeCommand("pnpm dev:web"), ["pnpm", "dev:web"])
  assert.deepEqual(tokenizeCommand('node -e "a b"'), ["node", "-e", "a b"])
  assert.deepEqual(tokenizeCommand(["pnpm", "build"]), ["pnpm", "build"])
})

test("migrateServiceToV2: v1 → v2 (command array, port autoAllocate, health, restart)", async () => {
  const { migrateServiceToV2 } = await imp()
  const v2 = migrateServiceToV2({ name: "api", command: "pnpm dev:api", port: 3000, health: "/health" })
  assert.deepEqual(v2.command, ["pnpm", "dev:api"])
  assert.equal(v2.port.preferred, 3000)
  assert.equal(v2.port.env, "API_PORT")
  assert.equal(v2.port.autoAllocate, true)
  assert.deepEqual(v2.health.readiness, { type: "http", path: "/health", timeoutSeconds: 60 })
  assert.equal(v2.health.liveness.type, "process")
  assert.equal(v2.restart.policy, "on-failure")
})

test("buildRuntimeManifest: schemaVersion 2 + serviços migrados", async () => {
  const { buildRuntimeManifest } = await imp()
  const m = buildRuntimeManifest({ services: [{ name: "web", command: "pnpm dev:web", port: 5173, health: "/" }] })
  assert.equal(m.schemaVersion, 2)
  assert.equal(m.services[0].name, "web")
  assert.ok(Array.isArray(m.services[0].command))
})

test("validateRuntimeManifest: válido passa; inválidos pegam (command string, sem name)", async () => {
  const { buildRuntimeManifest, validateRuntimeManifest } = await imp()
  const good = buildRuntimeManifest({ services: [{ name: "api", command: "pnpm dev:api", port: 3000, health: "/health" }] })
  assert.equal(validateRuntimeManifest(good).valid, true)

  const badCmd = { schemaVersion: 2, services: [{ name: "api", command: "pnpm dev:api" }] } // command STRING
  const r1 = validateRuntimeManifest(badCmd)
  assert.equal(r1.valid, false)
  assert.match(r1.errors.join(" "), /command deve ser array/)

  const badName = { schemaVersion: 2, services: [{ command: ["pnpm", "x"] }] }
  assert.equal(validateRuntimeManifest(badName).valid, false)

  assert.equal(validateRuntimeManifest({ schemaVersion: 1, services: [] }).valid, false)
})

test("validateRuntimeManifest: nome com path-traversal é REJEITADO (anti-escape)", async () => {
  const { validateRuntimeManifest } = await imp()
  const evil = { schemaVersion: 2, services: [{ name: "../../../PWNED", command: ["node", "x"] }] }
  const r = validateRuntimeManifest(evil)
  assert.equal(r.valid, false)
  assert.match(r.errors.join(" "), /name inválido/)

  const evil2 = { schemaVersion: 2, services: [{ name: "a/b", command: ["node", "x"] }] }
  assert.equal(validateRuntimeManifest(evil2).valid, false)
})

test("loadRuntimeManifest: prefere runtime.json; deriva de services.json se ausente", async () => {
  const { loadRuntimeManifest } = await imp()
  const norm = (p) => p.replace(/\\/g, "/")
  // só services.json (v1) → deriva v2
  const io1 = {
    exists: (p) => norm(p).endsWith("/.gstack/services.json"),
    readJson: (p) => norm(p).endsWith("services.json") ? { services: [{ name: "api", command: "pnpm dev:api", port: 3000, health: "/health" }] } : null,
  }
  const m1 = loadRuntimeManifest("/proj", io1)
  assert.equal(m1.schemaVersion, 2)
  assert.ok(Array.isArray(m1.services[0].command))

  // runtime.json (v2) tem prioridade
  const io2 = {
    exists: (p) => norm(p).endsWith("/.gstack/runtime.json"),
    readJson: () => ({ schemaVersion: 2, services: [{ name: "web", command: ["pnpm", "dev:web"] }] }),
  }
  assert.equal(loadRuntimeManifest("/proj", io2).services[0].name, "web")
})

// ── Manifest v3 + preview health-gated (PRD42 S42.6) ─────────────────────────────
test("v3: migração não-destrutiva v2→v3 adiciona campos de projeto e preserva services", async () => {
  const { buildRuntimeManifest, migrateManifestToV3, validateRuntimeManifestV3 } = await imp()
  const v2 = buildRuntimeManifest({ services: [{ name: "web", command: "pnpm dev", port: 3000 }] })
  const v3 = migrateManifestToV3(v2)
  assert.equal(v3.schemaVersion, 3)
  assert.equal(v3.migratedFrom, 2)
  assert.equal(v3.services.length, 1, "services preservados")
  assert.deepEqual(v3.workflows, [])
  assert.ok(v3.health && v3.health.type === "http")
  assert.equal(validateRuntimeManifestV3(v3).valid, true)
  // idempotente
  assert.equal(migrateManifestToV3(v3).schemaVersion, 3)
})

test("v3: buildRuntimeManifestV3 aceita workflows/postMerge/deploy; v2 segue válido", async () => {
  const { buildRuntimeManifestV3, validateRuntimeManifest, validateRuntimeManifestV3, buildRuntimeManifest } = await imp()
  const v3 = buildRuntimeManifestV3({
    services: [{ name: "api", command: "node server.js", port: 8080 }],
    workflows: [{ name: "Project", run: "pnpm dev" }], postMerge: { path: "scripts/post-merge.sh" },
  })
  assert.equal(v3.schemaVersion, 3)
  assert.equal(v3.workflows[0].name, "Project")
  assert.equal(validateRuntimeManifestV3(v3).valid, true)
  // v2 continua um contrato válido separado (não quebra)
  assert.equal(validateRuntimeManifest(buildRuntimeManifest({ services: [] })).valid, true)
})

test("CONTROLE NEGATIVO v3: schemaVersion errado e workflows não-array reprovam", async () => {
  const { validateRuntimeManifestV3 } = await imp()
  assert.equal(validateRuntimeManifestV3({ schemaVersion: 2, services: [], workflows: [] }).valid, false)
  const r = validateRuntimeManifestV3({ schemaVersion: 3, services: [], workflows: "nope" })
  assert.equal(r.valid, false)
  assert.match(r.errors.join(" "), /workflows/)
})

test("preview health-gated: URL só ready com health probe ok (nunca 'verde por subir')", async () => {
  const { evaluatePreviewReadiness } = await imp()
  const ok = evaluatePreviewReadiness({ url: "http://127.0.0.1:3000/", healthProbe: { ok: true } })
  assert.equal(ok.ready, true)
  assert.equal(ok.url, "http://127.0.0.1:3000/")
  // CONTROLE NEGATIVO: health falhou OU ausente → URL retida
  const unhealthy = evaluatePreviewReadiness({ url: "http://x/", healthProbe: { ok: false } })
  assert.equal(unhealthy.ready, false)
  assert.equal(unhealthy.url, null)
  const noProbe = evaluatePreviewReadiness({ url: "http://x/" })
  assert.equal(noProbe.ready, false)
  assert.match(noProbe.reason, /não é liberada só por subir/)
})
