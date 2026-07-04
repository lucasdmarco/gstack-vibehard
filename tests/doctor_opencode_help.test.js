import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "cli", "index.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function captureLog() {
  const orig = console.log
  let buf = ""
  console.log = (...a) => { buf += a.join(" ") + "\n" }
  return { restore: () => { console.log = orig }, get: () => buf }
}

test("doctor --help lista --opencode, --fix opencode e --restore-jsonc (PRD24 24.1 P0)", async () => {
  const { helpFor } = await imp()
  const cap = captureLog()
  try { helpFor("doctor") } finally { cap.restore() }
  const out = cap.get()
  assert.match(out, /--opencode/, "help lista --opencode")
  assert.match(out, /--fix opencode/, "help lista o caminho seguro --fix opencode")
  assert.match(out, /--restore-jsonc/, "help lista --restore-jsonc")
})
