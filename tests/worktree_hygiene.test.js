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

test("delegate --worktree: avisa quando há .env rastreado (não bloqueia)", async () => {
  const dmod = path.join(repoRoot, "src", "commands", "delegate.js")
  const { delegateCommand } = await import(`${pathToFileURL(dmod)}?t=${Date.now()}`)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  try {
    // exec serve tanto p/ git ls-files (.env) quanto p/ a delegação (opencode ausente)
    await delegateCommand(["opencode", "--task", "x", "--worktree", "--yes"], {
      cwd: "/repo",
      exec: (file, args) => {
        if (file === "git" && (args || []).includes("ls-files")) return ".env\0"
        throw new Error("opencode missing")
      },
    })
  } finally { process.stdout.write = orig }
  assert.match(buf, /\.env RASTREADO/, "avisa sobre o .env rastreado")
})
