import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// ── P1 (máquina limpa): o install NUNCA pode chamar `headroom wrap` ──────────
// O wrap muda config de harness FORA do manifest (o rtk do headroom chegou a
// registrar hooks no Claude Code do usuário antes de falhar). Routing é SÓ o
// opt-in project-scoped `tools headroom enable`. Guard por fonte: nenhuma chamada
// a `wrap` pode voltar ao instalador.
test("P1: nenhum código de install invoca `headroom wrap` (guard de fonte)", () => {
  const files = ["src/harness/headroom.js", "src/installer/install.js"]
  for (const rel of files) {
    const src = readFileSync(path.join(repoRoot, rel), "utf-8")
    for (const line of src.split("\n")) {
      const code = line.split("//")[0] // comentários podem citar a proibição
      assert.ok(!/["'`]wrap["'`]/.test(code), `${rel}: chamada a headroom wrap proibida → ${line.trim()}`)
    }
  }
})

test("P1: installHeadroom aponta o routing opt-in em vez de wrapar", async () => {
  const src = readFileSync(path.join(repoRoot, "src", "harness", "headroom.js"), "utf-8")
  assert.match(src, /tools headroom enable/, "mensagem aponta o caminho opt-in")
  assert.match(src, /NUNCA `headroom wrap`/, "proibição documentada no código")
})

// ── P2 (máquina limpa): plugins OpenCode atualizam mesmo com harness "já instalado" ──
test("P2: refreshOpenCodePlugins copia os 3 plugins gerenciados (manifest-owned)", async () => {
  const { refreshOpenCodePlugins } = await imp("src/harness/opencode.js")
  const home = await mkdtemp(path.join(tmpdir(), "gstack-p2-"))
  try {
    const report = { updated: [], added: [], skipped: [] }
    const n = refreshOpenCodePlugins({ home }, report)
    assert.equal(n, 3, "3 plugins gerenciados copiados")
    for (const f of ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"]) {
      assert.ok(existsSync(path.join(home, ".config", "opencode", "plugins", f)), `${f} presente`)
    }
    assert.equal(report.updated.filter((u) => u.includes("plugins/")).length, 3)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test("P2: refresh ATUALIZA plugin antigo e NUNCA toca opencode.json/.jsonc", async () => {
  const { refreshOpenCodePlugins } = await imp("src/harness/opencode.js")
  const home = await mkdtemp(path.join(tmpdir(), "gstack-p2-"))
  try {
    const ocDir = path.join(home, ".config", "opencode")
    await mkdir(path.join(ocDir, "plugins"), { recursive: true })
    // upgrade real: plugin de versão antiga no lugar + config SAGRADA do usuário
    await writeFile(path.join(ocDir, "plugins", "gstack-security.js"), "// versao 3.21.1 antiga\n")
    const jsonc = "{\n  // config do usuário\n  provider: {}\n}\n"
    await writeFile(path.join(ocDir, "opencode.jsonc"), jsonc)
    const report = { updated: [], added: [], skipped: [] }
    refreshOpenCodePlugins({ home }, report)
    const updated = await readFile(path.join(ocDir, "plugins", "gstack-security.js"), "utf-8")
    assert.ok(!updated.includes("versao 3.21.1 antiga"), "plugin foi atualizado para a versão atual")
    assert.equal(await readFile(path.join(ocDir, "opencode.jsonc"), "utf-8"), jsonc, "jsonc byte-for-byte intocado")
    assert.ok(!existsSync(path.join(ocDir, "opencode.json")), "não cria opencode.json")
  } finally { await rm(home, { recursive: true, force: true }) }
})
