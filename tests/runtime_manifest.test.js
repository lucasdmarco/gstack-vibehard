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
