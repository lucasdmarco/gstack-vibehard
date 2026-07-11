import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "installer", "remote-policy.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("isRemoteAllowed: só HTTPS de origem na allowlist", async () => {
  const { isRemoteAllowed } = await imp()
  assert.equal(isRemoteAllowed("https://bun.sh/install"), true)
  assert.equal(isRemoteAllowed("https://sh.rustup.rs"), true)
  assert.equal(isRemoteAllowed("http://bun.sh/install"), false, "http não")
  assert.equal(isRemoteAllowed("https://evil.example.com/x.sh"), false, "fora da allowlist")
  assert.equal(isRemoteAllowed("not a url"), false)
})

test("checkRemoteDownload: DEFAULT bloqueia; opt-in + origem confiável libera", async () => {
  const { checkRemoteDownload } = await imp()
  assert.equal(checkRemoteDownload("https://bun.sh/install").allowed, false, "default: não executa")
  assert.equal(checkRemoteDownload("https://bun.sh/install", { allowRemote: true }).allowed, true)
  assert.equal(checkRemoteDownload("https://evil.com/x.sh", { allowRemote: true }).allowed, false, "opt-in não basta se origem ruim")
})

test("checkRemoteDownload: env GSTACK_ALLOW_REMOTE_DOWNLOADS=1 habilita", async () => {
  const prev = process.env.GSTACK_ALLOW_REMOTE_DOWNLOADS
  process.env.GSTACK_ALLOW_REMOTE_DOWNLOADS = "1"
  try {
    const { checkRemoteDownload } = await imp()
    assert.equal(checkRemoteDownload("https://sh.rustup.rs").allowed, true)
  } finally {
    if (prev === undefined) delete process.env.GSTACK_ALLOW_REMOTE_DOWNLOADS; else process.env.GSTACK_ALLOW_REMOTE_DOWNLOADS = prev
  }
})

test("assertLocalExec: aceita script dentro do dir empacotado, recusa o que escapa", async () => {
  const { assertLocalExec } = await imp()
  const base = path.join(repoRoot, "scripts", "scripts")
  assert.equal(assertLocalExec(path.join(base, "setup-gstack.ps1"), base), path.resolve(base, "setup-gstack.ps1"))
  assert.throws(() => assertLocalExec(path.join(base, "..", "..", "evil.ps1"), base), /fora do diretório empacotado/)
  assert.throws(() => assertLocalExec("C:/Windows/System32/evil.ps1", base), /fora do diretório empacotado/)
})

// GUARD: qualquer arquivo que faça execução remota perigosa (ExecutionPolicy
// Bypass / sh de script baixado) DEVE passar pela política (importar remote-policy).
test("GUARD: execução remota só em arquivos gated por remote-policy", () => {
  const danger = /ExecutionPolicy["',\s]+Bypass|-ExecutionPolicy.*Bypass/
  const offenders = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".js")) {
        const src = readFileSync(p, "utf-8")
        if (danger.test(src) && p !== mod && !src.includes("remote-policy.js")) offenders.push(p)
      }
    }
  }
  walk(path.join(repoRoot, "src"))
  assert.deepEqual(offenders, [], `exec remoto sem política em: ${offenders.join(", ")}`)
})
