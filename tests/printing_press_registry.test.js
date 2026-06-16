import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const registryModule = path.join(repoRoot, "src", "printing-press", "registry.js")
const createModule = path.join(repoRoot, "src", "cli", "create.js")

test("buildIntegrationsRegistry: schema dual-lane por template", async () => {
  const { buildIntegrationsRegistry, SUGGESTIONS_BY_TEMPLATE } = await import(`${pathToFileURL(registryModule)}?t=${Date.now()}`)

  const saas = buildIntegrationsRegistry("saas-auth-stripe")
  assert.equal(saas.schemaVersion, 1)
  // dupla via
  assert.equal(saas.composio.lane, "cloud")
  assert.equal(saas.composio.role, "write+oauth")
  assert.equal(saas.printingPress.lane, "local")
  assert.equal(saas.printingPress.enabled, false, "opt-in: nada habilitado por padrao")
  assert.deepEqual(saas.printingPress.suggested, ["stripe", "linear", "sentry"])
  assert.deepEqual(saas.routing, { reads: "printing-press", writes: "composio" })

  // cada template tem suas sugestoes
  for (const tpl of Object.keys(SUGGESTIONS_BY_TEMPLATE)) {
    assert.deepEqual(buildIntegrationsRegistry(tpl).printingPress.suggested, SUGGESTIONS_BY_TEMPLATE[tpl])
  }
  // template desconhecido cai no default fullstack
  assert.deepEqual(
    buildIntegrationsRegistry("xpto").printingPress.suggested,
    SUGGESTIONS_BY_TEMPLATE["fullstack-monorepo"],
  )
})

test("buildIntegrationsRegistry reflete status do composio quando informado", async () => {
  const { buildIntegrationsRegistry } = await import(`${pathToFileURL(registryModule)}?t=${Date.now()}`)
  assert.equal(buildIntegrationsRegistry("saas-auth-stripe").composio.status, "not_configured")
  assert.equal(buildIntegrationsRegistry("saas-auth-stripe", { composioStatus: "detected" }).composio.status, "detected")
})

test("writeRuntimeFiles gera .gstack/integrations.json declarativo (sem instalar)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-integ-"))
  try {
    const { writeRuntimeFiles } = await import(`${pathToFileURL(createModule)}?t=${Date.now()}`)
    writeRuntimeFiles({
      projectDir: tmp, projectName: "proj", now: () => new Date().toISOString(),
      projectRoot: repoRoot, templateName: "mobile-backend",
    })
    const file = path.join(tmp, ".gstack", "integrations.json")
    assert.equal(existsSync(file), true)
    const reg = JSON.parse(await readFile(file, "utf-8"))
    assert.deepEqual(reg.printingPress.suggested, ["revenuecat", "firebase", "supabase", "sentry"])
    assert.equal(reg.printingPress.enabled, false)
    assert.deepEqual(reg.printingPress.installed, [])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
