import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")

test("lint: todo o código-fonte parseia (node --check) — exit 0", () => {
  const out = execFileSync(process.execPath, [path.join("scripts", "lint.mjs")], {
    cwd: repoRoot, encoding: "utf-8", timeout: 120000,
  })
  assert.match(out, /0 com erro de sintaxe/)
})
