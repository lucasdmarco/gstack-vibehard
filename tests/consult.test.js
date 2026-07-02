import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function mkDirs(...subs) {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-consult-home-"))
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-consult-cwd-"))
  for (const s of subs) await mkdir(path.join(home, ...s.split("/")), { recursive: true })
  return { home, cwd, cleanup: async () => { await rm(home, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true }) } }
}

test("buildConsult: contrato do aceite — recommendedPath, doNotStack, preview, rollback", async () => {
  const { home, cwd, cleanup } = await mkDirs()
  try {
    const { buildConsult } = await imp("src/commands/consult.js")
    const c = buildConsult({ objective: "quero criar um SaaS com login, Stripe e painel admin", home, cwd })
    assert.equal(c.intent, "saas-auth-stripe")
    assert.equal(c.recommendedMode, "full")
    assert.equal(c.recommendedPath.id, "create-full")
    assert.match(c.recommendedPath.command, /create <nome> --template saas-auth-stripe --full/)
    assert.ok(Array.isArray(c.doNotStack) && c.doNotStack.length >= 2)
    assert.equal(c.previewCommand, "gstack_vibehard install --audit-only")
    assert.equal(c.rollbackCommand, "gstack_vibehard uninstall --dry-run")
  } finally { await cleanup() }
})

test("buildConsult: landing page → create-lite (default seguro)", async () => {
  const { home, cwd, cleanup } = await mkDirs()
  try {
    const { buildConsult } = await imp("src/commands/consult.js")
    const c = buildConsult({ objective: "landing page institucional", home, cwd })
    assert.equal(c.recommendedPath.id, "create-lite")
    assert.doesNotMatch(c.recommendedPath.command, /--full/)
  } finally { await cleanup() }
})

test("consult é READ-ONLY: não cria nada no cwd nem no home", async () => {
  const { home, cwd, cleanup } = await mkDirs()
  try {
    const { consultCommand } = await imp("src/commands/consult.js")
    const beforeCwd = (await readdir(cwd)).sort()
    const beforeHome = (await readdir(home)).sort()
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    try { consultCommand(["quero", "uma", "api", "rest", "--json"], { home, cwd }) } finally { process.stdout.write = orig }
    assert.deepEqual((await readdir(cwd)).sort(), beforeCwd, "cwd intocado")
    assert.deepEqual((await readdir(home)).sort(), beforeHome, "home intocado")
    const parsed = JSON.parse(buf.trim())
    assert.ok(parsed.recommendedPath, "JSON puro com contrato completo")
  } finally { await cleanup() }
})

test("detecção de instalação EMPILHADA: ~/.gstack/hooks + ~/.codex/hooks → alerta com repair", async () => {
  const { home, cwd, cleanup } = await mkDirs(".gstack/hooks", ".codex/hooks")
  try {
    const { buildConsult, detectInstallPaths } = await imp("src/commands/consult.js")
    const paths = detectInstallPaths({ home, cwd })
    assert.equal(paths.stacked, true)
    const c = buildConsult({ objective: "web app", home, cwd })
    assert.ok(c.doNotStack[0].includes("dois caminhos"), "alerta explícito de empilhamento")
    assert.match(c.doNotStack[0], /--reinstall|legacy-name-cleanup/, "sugere repair/reset")
    assert.deepEqual(c.risks, ["instalação empilhada detectada (legado + atual)"])
  } finally { await cleanup() }
})

test("projeto já ativo (.gstack no cwd) → recomendação é status, não reinstalar", async () => {
  const { home, cwd, cleanup } = await mkDirs()
  try {
    await mkdir(path.join(cwd, ".gstack"), { recursive: true })
    const { buildConsult } = await imp("src/commands/consult.js")
    const c = buildConsult({ objective: "web app", home, cwd })
    assert.equal(c.recommendedPath.id, "already-active")
    assert.match(c.recommendedPath.command, /status/)
  } finally { await cleanup() }
})

test("start chama consult internamente (recomendação aparece antes do plano)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-consult-start-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    try {
      await startCommand([], { cwd, objective: "landing page simples", projectName: "lp", mode: "lite", confirm: async () => false })
    } finally { process.stdout.write = orig }
    assert.match(buf, /Recomendação: create-lite/, "consult rodou dentro do start")
    const recIdx = buf.indexOf("Recomendação:")
    const planIdx = buf.indexOf("Passos (em ordem)")
    assert.ok(recIdx !== -1 && planIdx !== -1 && recIdx < planIdx, "consult vem ANTES do plano")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
