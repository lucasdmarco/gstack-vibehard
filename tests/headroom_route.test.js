import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "tools", "headroom-route.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

// snapshot recursivo dos arquivos sob um dir (para provar "nada fora do projeto")
async function underProject(cwd, p) {
  return path.resolve(p).startsWith(path.resolve(cwd))
}

test("enableRouting: cria env project-scoped (.gstack/headroom), nada fora do projeto", async () => {
  const { enableRouting } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-hr-"))
  try {
    const r = enableRouting({ cwd, harness: "codex", projectOnly: true })
    assert.equal(r.enabled, true)
    assert.equal(r.envVar, "OPENAI_BASE_URL")
    for (const f of r.files.concat(r.manifestPath)) {
      assert.ok(existsSync(f), `criou ${f}`)
      assert.ok(await underProject(cwd, f), "arquivo dentro do projeto (nada global)")
    }
    const sh = await readFile(r.files.find((f) => f.endsWith("env.sh")), "utf-8")
    assert.match(sh, /export OPENAI_BASE_URL="http:\/\/127\.0\.0\.1:8787"/)
    // manifest registra o que foi criado (p/ restore)
    const manifest = JSON.parse(await readFile(r.manifestPath, "utf-8"))
    assert.equal(manifest.harness, "codex")
    assert.equal(manifest.files.length, 2)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("enableRouting: recusa OpenCode (fora do routing automático) e modo global", async () => {
  const { enableRouting } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-hr-"))
  try {
    const oc = enableRouting({ cwd, harness: "opencode", projectOnly: true })
    assert.equal(oc.refused, true)
    assert.match(oc.reason, /OpenCode|fora do routing/i)
    assert.equal(existsSync(path.join(cwd, ".gstack", "headroom")), false, "recusa não escreve nada")
    const glob = enableRouting({ cwd, harness: "codex", projectOnly: false })
    assert.equal(glob.refused, true, "modo global é recusado (só --project-only)")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("disableRouting --restore: reverte tudo que o enable criou", async () => {
  const { enableRouting, disableRouting } = await imp()
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-hr-"))
  try {
    const en = enableRouting({ cwd, harness: "claude", projectOnly: true })
    assert.ok(existsSync(en.dir))
    const dis = disableRouting({ cwd })
    assert.equal(dis.disabled, true)
    assert.ok(dis.removed.length >= 2, "removeu env + manifest")
    assert.equal(existsSync(en.dir), false, "dir project-scoped removido")
    // idempotente: sem routing ativo → não faz nada, sem crash
    assert.equal(disableRouting({ cwd }).disabled, false)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("tools headroom enable --json: JSON puro + refusa opencode via CLI", async () => {
  const toolsMod = path.join(repoRoot, "src", "commands", "tools.js")
  const { toolsCommand } = await import(`${pathToFileURL(toolsMod)}?t=${Date.now()}`)
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-hr-"))
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try {
    await toolsCommand(["headroom", "enable", "--harness", "opencode", "--json"], { cwd })
  } finally { process.stdout.write = orig }
  const parsed = JSON.parse(buf.trim())
  assert.equal(parsed.refused, true)
  await rm(cwd, { recursive: true, force: true })
})
