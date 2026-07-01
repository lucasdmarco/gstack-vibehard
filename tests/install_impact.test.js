import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "installer", "impact.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("buildInstallImpact: lista categorias globais com paths sob o home", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    const { buildInstallImpact } = await imp()
    const impact = buildInstallImpact({ home })
    const cats = impact.map((c) => c.category)
    assert.ok(cats.includes("hooks"))
    assert.ok(cats.includes("harness-config"))
    assert.ok(cats.includes("mcp-global"))
    assert.ok(cats.includes("vault"))
    assert.ok(cats.includes("deps"))
    // todos os paths de fs ficam sob o home injetado (nada fora)
    for (const c of impact) {
      if (c.category === "deps") continue // deps são nomes de ferramentas, não paths
      for (const it of c.items) assert.ok(it.path.startsWith(home), `${it.path} deveria estar sob ${home}`)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("buildInstallImpact: project-only remove MCP global, vault e deps", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    const { buildInstallImpact } = await imp()
    const impact = buildInstallImpact({ home, projectOnly: true })
    const cats = impact.map((c) => c.category)
    assert.ok(!cats.includes("mcp-global"), "project-only não toca MCP global")
    assert.ok(!cats.includes("vault"), "project-only não cria vault")
    assert.ok(!cats.includes("deps"), "project-only não instala deps")
    assert.ok(cats.includes("hooks"), "ainda registra hooks")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("buildInstallImpact: withMcp:false remove MCP global (opt-in)", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    const { buildInstallImpact } = await imp()
    const off = buildInstallImpact({ home, withMcp: false }).map((c) => c.category)
    assert.ok(!off.includes("mcp-global"), "sem --global-mcp não lista MCP global")
    const on = buildInstallImpact({ home }).map((c) => c.category)
    assert.ok(on.includes("mcp-global"), "default ainda informa MCP global como possível")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("buildInstallImpact: --harness filtra a config de harness", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    const { buildInstallImpact } = await imp()
    const impact = buildInstallImpact({ home, harnessIds: ["claude"] })
    const hc = impact.find((c) => c.category === "harness-config")
    assert.ok(hc.items.some((i) => i.path.includes("settings.json")), "inclui claude settings")
    assert.ok(!hc.items.some((i) => i.path.includes("opencode")), "não inclui opencode quando só claude")
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("buildInstallImpact: action 'modify' quando o alvo já existe", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    await mkdir(path.join(home, ".claude"), { recursive: true })
    await mkdir(path.join(home, ".agents", "skills"), { recursive: true })
    const { buildInstallImpact } = await imp()
    const impact = buildInstallImpact({ home, harnessIds: ["claude"] })
    const skills = impact.find((c) => c.category === "skills-scripts")
    const skillsItem = skills.items.find((i) => i.path.endsWith(path.join(".agents", "skills")))
    assert.equal(skillsItem.action, "modify")
  } finally { await rm(home, { recursive: true, force: true }) }
})

// ── Regressão PRD14 §4.16: impact e install sincronizados (sem dependência fantasma) ──
test("buildInstallImpact: deps do impact existem no install real (sem item fantasma)", async () => {
  const { readFile } = await import("node:fs/promises")
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    const { buildInstallImpact } = await imp()
    const impact = buildInstallImpact({ home })
    const deps = impact.find((c) => c.category === "deps").items.map((i) => i.path)

    // `cli-anything-hub` nunca existiu no npm (E404) — não pode voltar ao preflight
    const flat = JSON.stringify(impact)
    assert.ok(!flat.includes("cli-anything-hub"), "impact não lista dependência fantasma")

    // Cada dep anunciada no preflight precisa de âncora REAL no fluxo de install
    // (install.js ou módulos de deps) — impact sem lastro = promessa falsa ao usuário.
    const sources = await Promise.all([
      readFile(path.join(repoRoot, "src", "installer", "install.js"), "utf-8"),
      readFile(path.join(repoRoot, "src", "installer", "deps.js"), "utf-8").catch(() => ""),
      readFile(path.join(repoRoot, "src", "harness", "headroom.js"), "utf-8").catch(() => ""),
    ])
    const installSrc = sources.join("\n").toLowerCase()
    for (const dep of deps) {
      const anchor = dep.split(" ")[0].toLowerCase() // "Playwright Chromium" → "playwright"
      assert.ok(installSrc.includes(anchor), `dep '${dep}' do impact não tem âncora no install real`)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("renderImpactMarkdown: gera markdown com aviso de preflight", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-impact-"))
  try {
    const { buildInstallImpact, renderImpactMarkdown } = await imp()
    const md = renderImpactMarkdown(buildInstallImpact({ home }), { when: "2026-06-19", harnessIds: ["claude"] })
    assert.match(md, /nada foi escrito/)
    assert.match(md, /Hooks/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
