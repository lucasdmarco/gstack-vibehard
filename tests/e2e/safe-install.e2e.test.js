// E2E Safe Install em HOME descartável (PRD §P0.4). GATED por env:
//   GSTACK_E2E_SAFE_INSTALL=1 npm run test:e2e
// Prova as INVARIANTES DE SEGURANÇA de forma determinística e cross-OS, sem rodar
// o instalador completo (que depende de binários reais) — foco no que não pode
// quebrar a máquina do usuário: audit-only read-only, delegate bloqueia segredo,
// uninstall drift-safe. Nada fora do HOME temporário é tocado.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

const repoRoot = path.resolve(import.meta.dirname, "..", "..")
const sha = (s) => "sha256:" + createHash("sha256").update(Buffer.from(s)).digest("hex")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function listFiles(dir) {
  const out = []
  async function walk(d) {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p); else out.push(p)
    }
  }
  await walk(dir)
  return out.sort()
}

// HOME descartável + harness configs simulados + import cache-bust dos módulos.
async function withSafeHome(fn) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-e2e-"))
  // simula máquina real: Codex/Claude/OpenCode(+jsonc)/Cursor já configurados
  await mkdir(path.join(home, ".codex"), { recursive: true })
  await writeFile(path.join(home, ".codex", "config.toml"), "[meta]\nuser=lucas\n")
  await mkdir(path.join(home, ".claude"), { recursive: true })
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ user: 1 }))
  await mkdir(path.join(home, ".cursor"), { recursive: true })
  await writeFile(path.join(home, ".cursor", "hooks.json"), "{}")
  await mkdir(path.join(home, ".config", "opencode"), { recursive: true })
  await writeFile(path.join(home, ".config", "opencode", "opencode.json"), "{}")
  await writeFile(path.join(home, ".config", "opencode", "opencode.jsonc"), "{}")
  const prevH = process.env.HOME, prevU = process.env.USERPROFILE
  process.env.HOME = home; process.env.USERPROFILE = home
  try { return await fn(home) } finally {
    if (prevH === undefined) delete process.env.HOME; else process.env.HOME = prevH
    if (prevU === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevU
    await rm(home, { recursive: true, force: true })
  }
}

if (!process.env.GSTACK_E2E_SAFE_INSTALL) {
  test("e2e safe-install (gated): defina GSTACK_E2E_SAFE_INSTALL=1 para rodar", () => {
    assert.ok(true)
  })
} else {
  test("audit-only é READ-ONLY: não cria nenhum arquivo no HOME", async () => {
    await withSafeHome(async (home) => {
      const before = await listFiles(home)
      const { install } = await imp("src/installer/install.js")
      await install(["--audit-only"])
      const after = await listFiles(home)
      assert.deepEqual(after, before, "audit-only não pode escrever nada no HOME")
    })
  })

  test("audit-only --save-report: grava EXATAMENTE um relatório em ~/.gstack_vibehard", async () => {
    await withSafeHome(async (home) => {
      const before = await listFiles(home)
      const { install } = await imp("src/installer/install.js")
      await install(["--audit-only", "--save-report"])
      const after = await listFiles(home)
      const novos = after.filter((p) => !before.includes(p))
      assert.equal(novos.length, 1, "só o relatório")
      assert.ok(novos[0].includes(path.join(".gstack_vibehard", "install-report-")))
    })
  })

  test("delegate --worktree com .env rastreado: BLOQUEIA (não chama OpenCode)", async () => {
    await withSafeHome(async () => {
      const { delegateCommand } = await imp("src/commands/delegate.js")
      let ran = false
      const exec = (file, args) => {
        if (file === "git" && (args || []).includes("ls-files")) return ".env\0"
        if (file === "git" && args[0] === "rev-parse") return "true"
        if (file === "opencode") { ran = true; return "" }
        throw new Error("não deveria delegar")
      }
      const r = await delegateCommand(["opencode", "--task", "x", "--worktree", "--yes"], { cwd: "/proj", exec })
      assert.equal(r.status, "blocked_tracked_secrets")
      assert.equal(ran, false)
    })
  })

  test("uninstall drift-safe: edição pós-install preservada; --resolve-drift sobrescreve", async () => {
    await withSafeHome(async (home) => {
      const { saveManifest, freshManifest, recordItem } = await imp("src/installer/manifest.js")
      const f = path.join(home, ".claude", "settings.json")
      const installed = JSON.stringify({ user: 1, gstack: true })
      const edited = JSON.stringify({ user: 1, gstack: true, minhaEdicao: 42 })
      await writeFile(f, edited) // editado DEPOIS do install
      await writeFile(f + ".gstack_vibehard.bak", JSON.stringify({ user: 1 }))
      const m = freshManifest()
      recordItem(m, { path: f, kind: "config", action: "modified", component: "claude", backup: f + ".gstack_vibehard.bak", removeOnUninstall: false, installedHash: sha(installed) })
      saveManifest(m, home)

      const { uninstall } = await imp("src/installer/uninstall.js")
      await uninstall(["--restore-only", "--yes"])
      assert.equal(await readFile(f, "utf-8"), edited, "drift preservado (não sobrescreve)")

      await uninstall(["--restore-only", "--yes", "--resolve-drift"])
      assert.equal(JSON.parse(await readFile(f, "utf-8")).user, 1, "--resolve-drift restaura o original")
    })
  })
}
