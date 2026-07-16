import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.0 (P0.1) — o `.mcp.json` gerado no Full NUNCA pode apontar para um pacote
// inexistente. O headroom MCP deve usar o BINÁRIO REAL (`headroom mcp`), exatamente como
// o caminho de install já faz (src/harness/headroom.js), e jamais
// `npx -y @gstack/headroom-proxy` — pacote fantasma (E404 no registry). Regra geral:
// nunca `npx -y` sem versão fixada em config gerada (faz o harness baixar da rede ao abrir).

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")
const silent = { info: () => {}, success: () => {}, warn: () => {}, error: () => {} }

async function scaffoldFull(cwd) {
  const { createProject } = await import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
  return createProject({ args: ["app-full", "--full"], cwd, projectRoot: repoRoot, now: () => "2026-07-13T00:00:00.000Z", logger: silent, execSync: () => Buffer.from("ok") })
}

test("Full .mcp.json: headroom aponta para o binário REAL, nunca o pacote fantasma", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-mcp-real-"))
  process.env.GSTACK_SKIP_PREFLIGHT = "1"; process.env.GSTACK_SKIP_SIDE_EFFECTS = "1"
  try {
    const cwd = path.join(tmp, "ws"); await mkdir(cwd, { recursive: true })
    await scaffoldFull(cwd)
    const mcp = JSON.parse(await readFile(path.join(cwd, "app-full", ".mcp.json"), "utf8"))
    const hr = mcp.mcpServers.headroom
    assert.ok(hr, "Full ainda declara headroom (comportamento preservado, só que honesto)")

    // Nenhum artefato gerado pode referenciar o pacote fantasma.
    const flat = JSON.stringify(mcp)
    assert.ok(!flat.includes("@gstack/headroom-proxy"), "CONTROLE NEGATIVO: nunca o pacote fantasma @gstack/headroom-proxy")
    assert.notEqual(hr.command, "npx", "não usar `npx -y` sem pin em config gerada")

    // Deve usar o binário real, idêntico ao caminho de install (harness/headroom.js).
    assert.equal(hr.command, "headroom", "headroom MCP usa o binário real")
    assert.deepEqual(hr.args, ["mcp"], "subcomando real `headroom mcp`")
  } finally {
    delete process.env.GSTACK_SKIP_PREFLIGHT; delete process.env.GSTACK_SKIP_SIDE_EFFECTS
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
