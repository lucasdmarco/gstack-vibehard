import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Contrato: cada template vertical gerado deve ser coerente —
 * todo script `pnpm <x>` referenciado num package.json existe como script,
 * imports Python tem deps declaradas, e o Dockerfile casa com a stack.
 * Usa scaffoldVerticalTemplate (exportado) num dir temporario, sem instalar nada.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const createModule = path.join(repoRoot, "src", "cli", "create.js")
const silentLogger = { info() {}, success() {}, warn() {}, error() {} }

async function scaffold(templateName) {
  const tmp = await mkdtemp(path.join(tmpdir(), `gstack-vtpl-${templateName}-`))
  const { scaffoldVerticalTemplate } = await import(`${pathToFileURL(createModule)}?t=${Date.now()}`)
  scaffoldVerticalTemplate(templateName, tmp, "proj", silentLogger)
  return tmp
}

async function readJson(p) {
  return JSON.parse(await readFile(p, "utf-8"))
}

/** Resolve um `pnpm --filter X dev` / `cd apps/X && pnpm dev` para o script alvo. */
function referencedFilterScripts(rootScripts) {
  const refs = []
  for (const cmd of Object.values(rootScripts)) {
    let m
    const re = /pnpm --filter (\S+) (\S+)/g
    while ((m = re.exec(cmd))) refs.push({ app: m[1], script: m[2] })
  }
  return refs
}

test("SaaS: dev:web/dev:api resolvem para scripts reais por app", async () => {
  const dir = await scaffold("saas-auth-stripe")
  try {
    const root = await readJson(path.join(dir, "package.json"))
    assert.ok(root.scripts["dev:web"] && root.scripts["dev:api"], "root tem dev:web/dev:api")
    for (const ref of referencedFilterScripts(root.scripts)) {
      const appPkg = await readJson(path.join(dir, "apps", ref.app, "package.json"))
      assert.ok(appPkg.scripts[ref.script], `apps/${ref.app} tem script ${ref.script}`)
    }
    assert.equal(existsSync(path.join(dir, "apps/web/package.json")), true)
    assert.equal(existsSync(path.join(dir, "apps/api/package.json")), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("Mobile: dev:mobile/dev:api resolvem e apps tem package.json", async () => {
  const dir = await scaffold("mobile-backend")
  try {
    const root = await readJson(path.join(dir, "package.json"))
    for (const ref of referencedFilterScripts(root.scripts)) {
      const appPkg = await readJson(path.join(dir, "apps", ref.app, "package.json"))
      assert.ok(appPkg.scripts[ref.script], `apps/${ref.app} tem script ${ref.script}`)
    }
    assert.equal(existsSync(path.join(dir, "apps/mobile/package.json")), true)
    assert.equal(existsSync(path.join(dir, "apps/api/package.json")), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("AI: import langchain_openai tem dep declarada e sem typo ChatOpenAi", async () => {
  const dir = await scaffold("ai-agent-platform")
  try {
    const pyproject = await readFile(path.join(dir, "pyproject.toml"), "utf-8")
    assert.ok(pyproject.includes("langchain-openai"), "pyproject declara langchain-openai")
    const agent = await readFile(path.join(dir, "agents", "research_agent.py"), "utf-8")
    assert.ok(agent.includes("from langchain_openai import ChatOpenAI"), "import correto")
    assert.ok(!agent.includes("ChatOpenAi"), "sem typo ChatOpenAi")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
