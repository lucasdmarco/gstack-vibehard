import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "delegation", "worktree.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("checkTrackedSecrets: detecta .env RASTREADO (exec injetado)", async () => {
  const { checkTrackedSecrets } = await imp()
  // git ls-files -z retorna NUL-separado
  const exec = () => ".env\0config/.env.local\0"
  const found = checkTrackedSecrets("/repo", exec)
  assert.deepEqual(found, [".env", "config/.env.local"])
})

test("checkTrackedSecrets: sem .env rastreado → lista vazia; erro git → vazio", async () => {
  const { checkTrackedSecrets } = await imp()
  assert.deepEqual(checkTrackedSecrets("/repo", () => ""), [])
  assert.deepEqual(checkTrackedSecrets("/repo", () => { throw new Error("not a repo") }), [])
})

test("delegate --worktree: BLOQUEIA quando há .env rastreado (não delega)", async () => {
  const dmod = path.join(repoRoot, "src", "commands", "delegate.js")
  const { delegateCommand } = await import(`${pathToFileURL(dmod)}?t=${Date.now()}`)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  let r
  try {
    // exec só responde a git ls-files (.env); se delegar, opencode lançaria
    r = await delegateCommand(["opencode", "--task", "x", "--worktree", "--yes"], {
      cwd: "/repo",
      exec: (file, args) => {
        if (file === "git" && (args || []).includes("ls-files")) return ".env\0"
        throw new Error("não deveria delegar com .env rastreado")
      },
    })
  } finally { process.stdout.write = orig }
  assert.equal(r.status, "blocked_tracked_secrets", "bloqueia a delegação")
  assert.match(buf, /BLOQUEADO/, "informa que bloqueou")
})
