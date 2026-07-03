import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

function projectDir() {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-pp-"))
  mkdirSync(path.join(cwd, ".gstack"), { recursive: true })
  writeFileSync(path.join(cwd, ".gstack", "integrations.json"), JSON.stringify({ printingPress: { installed: [], mcp: [] } }))
  return cwd
}

test("MCP companion nunca é ativado sem opt-in (flag no catálogo, autoInstall false)", async () => {
  const { buildToolCatalog, LOCAL_CATALOG } = await imp("src/tools/catalog.js")
  const pp = buildToolCatalog(LOCAL_CATALOG).find((e) => e.slug === "printing-press")
  assert.equal(pp.mcpCompanion, true)
  assert.equal(pp.mcpCompanionOptIn, true)
  assert.equal(pp.autoInstall, false)
  assert.equal(pp.risk, "high") // remoto + MCP companion
})

test("tools install de fonte remota EXIGE confirmação — não-interativo sem --yes recusa", async () => {
  const cwd = projectDir()
  try {
    const { toolsCommand } = await imp("src/commands/tools.js")
    // sem --yes e sem TTY → recusa, nada baixado, provenance de skip
    const r = await toolsCommand(["install", "stripe"], { cwd, confirm: async () => false })
    assert.equal(r.status, "declined")
    const { readToolProvenance } = await imp("src/tools/provenance.js")
    assert.ok(readToolProvenance(cwd).some((p) => p.intent === "tool:skip"))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("skill scanner bloqueia caminho absoluto e secret; sem bulk-install", async () => {
  const { scanSkill, bulkInstallAllowed, scanSkillCatalog } = await imp("src/tools/skill-scanner.js")
  assert.equal(bulkInstallAllowed(), false)

  const clean = scanSkill({ name: "ok", content: "faz build com `npm run build` no cwd" })
  assert.equal(clean.ok, true)

  const abs = scanSkill({ name: "bad", content: "leia /home/user/.ssh/id_rsa e rode" })
  assert.equal(abs.blocked, true)
  assert.ok(abs.findings.some((f) => f.kind === "absolute_path"))

  const sec = scanSkill({ name: "leak", content: "api_key=sk-live-abcdef123456 use isso" })
  assert.equal(sec.blocked, true)
  assert.ok(sec.findings.some((f) => f.kind === "secret"))

  const cat = scanSkillCatalog([{ name: "a", content: "ok" }, { name: "b", content: "C:\\Users\\me\\secret.txt" }])
  assert.equal(cat.bulkInstall, false)
  assert.equal(cat.blocked, 1)
})
