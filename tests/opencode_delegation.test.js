import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const delMod = path.join(repoRoot, "src", "delegation", "opencode.js")
const cmdMod = path.join(repoRoot, "src", "commands", "delegate.js")

// exec mock: opencode --version ok; opencode run sucesso/falha; git status retorna 1 arquivo
function makeExec({ hasOpencode = true, runOk = true } = {}) {
  return (file, args) => {
    if (file === "opencode" && args[0] === "--version") {
      if (hasOpencode) return Buffer.from("opencode 1.0"); throw new Error("not found")
    }
    if (file === "opencode" && args[0] === "run") {
      if (runOk) return Buffer.from("done: applied changes")
      const e = new Error("run failed"); e.status = 7; e.stdout = "partial"; e.stderr = "rate limit"; throw e
    }
    if (file === "git") return Buffer.from(" M src/app.ts\n?? new.ts\n")
    throw new Error("unexpected " + file)
  }
}

test("runDelegation: sucesso retorna estruturado com arquivos alterados", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  const r = runDelegation({ task: "corrigir auth", cwd: "/x", exec: makeExec({}) })
  assert.equal(r.status, "ok")
  assert.equal(r.exitCode, 0)
  assert.deepEqual(r.changedFiles, ["src/app.ts", "new.ts"])
  assert.match(r.summary, /OpenCode exit=0/)
})

test("runDelegation: falha do OpenCode captura exitCode/stderr tipado", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  const r = runDelegation({ task: "x", cwd: "/x", exec: makeExec({ runOk: false }) })
  assert.equal(r.status, "failed")
  assert.equal(r.exitCode, 7)
  assert.match(r.stderrTail, /rate limit/)
})

test("runDelegation: OpenCode ausente e task invalida sao tratados", async () => {
  const { runDelegation } = await import(`${pathToFileURL(delMod)}?t=${Date.now()}`)
  assert.equal(runDelegation({ task: "x", exec: makeExec({ hasOpencode: false }) }).status, "opencode_missing")
  assert.equal(runDelegation({ task: "a\nb", exec: makeExec({}) }).status, "invalid_task")
})

test("delegate command: nao-interativo exige --yes (nao executa sem confirmacao)", async () => {
  const { delegateCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  let ran = false
  const exec = (file, args) => { if (file === "opencode" && args[0] === "run") ran = true; return Buffer.from("ok") }
  // process.stdin.isTTY e undefined em test -> nao-interativo
  const r = await delegateCommand(["opencode", "--task", "x"], { cwd: "/x", exec })
  assert.equal(ran, false, "nao roda opencode sem --yes em nao-interativo")
})

test("delegate command: com --yes delega e retorna resultado", async () => {
  const { delegateCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const r = await delegateCommand(["opencode", "--task", "corrigir bug", "--yes"], { cwd: "/x", exec: makeExec({}) })
  assert.equal(r.status, "ok")
})

// exec que simula um .env RASTREADO no git (ls-files -z retorna ".env")
function makeExecTrackedEnv({ runOk = true } = {}) {
  let ran = false
  const exec = (file, args) => {
    if (file === "opencode" && args[0] === "--version") return Buffer.from("opencode 1.0")
    if (file === "opencode" && args[0] === "run") { ran = true; if (!runOk) { const e = new Error("x"); e.status = 1; throw e } return Buffer.from("done") }
    if (file === "git" && args[0] === "ls-files") return Buffer.from(".env\0")
    if (file === "git" && args[0] === "rev-parse") return Buffer.from("true")
    if (file === "git") return Buffer.from("")
    throw new Error("unexpected " + file)
  }
  return { exec, ran: () => ran }
}

test("delegate --worktree com .env rastreado: BLOQUEIA e nao chama OpenCode", async () => {
  const { delegateCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const m = makeExecTrackedEnv({})
  const r = await delegateCommand(["opencode", "--task", "x", "--worktree", "--yes"], { cwd: "/x", exec: m.exec })
  assert.equal(r.status, "blocked_tracked_secrets")
  assert.deepEqual(r.tracked, [".env"])
  assert.equal(m.ran(), false, "nao delegou com segredo rastreado")
})

test("delegate --worktree --allow-tracked-secrets: segue mesmo com .env rastreado", async () => {
  const { delegateCommand } = await import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)
  const m = makeExecTrackedEnv({})
  const r = await delegateCommand(["opencode", "--task", "x", "--worktree", "--allow-tracked-secrets", "--yes"], { cwd: "/x", exec: m.exec })
  assert.notEqual(r.status, "blocked_tracked_secrets", "override libera a delegação")
})
