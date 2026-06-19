import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const cmdMod = path.join(repoRoot, "src", "commands", "publish-guard.js")
const imp = () => import(`${pathToFileURL(cmdMod)}?t=${Date.now()}`)

async function repo(version, changelog) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-pgc-"))
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "x", version }))
  await writeFile(path.join(cwd, "CHANGELOG.md"), changelog)
  return cwd
}

const gitExec = ({ tags = [], porcelain = "" } = {}) => (file, args) => {
  if (file === "git" && args[0] === "status") return porcelain
  if (file === "git" && args[0] === "tag") return tags.join("\n")
  if (file === "git" && args[0] === "rev-parse") return "master"
  if (file === "gh") throw new Error("no gh")
  return ""
}

test("publish-guard --json: pass quando tudo ok", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]\nx")
  try {
    const { publishGuardCommand } = await imp()
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    try { await publishGuardCommand(["--json"], { cwd, exec: gitExec({ tags: ["v2.28.1"] }), noExit: true }) }
    finally { process.stdout.write = orig }
    const out = JSON.parse(buf.trim())
    assert.equal(out.status, "pass")
    assert.equal(out.version, "2.29.0")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("publish-guard: retorna fail (e marca exitCode) com tree suja", async () => {
  const cwd = await repo("2.29.0", "## [2.29.0]")
  try {
    const { publishGuardCommand } = await imp()
    const prev = process.exitCode
    let buf = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { buf += String(s); return true }
    let r
    try { r = await publishGuardCommand([], { cwd, exec: gitExec({ tags: ["v2.28.1"], porcelain: " M a.js" }) }) }
    finally { process.stdout.write = orig }
    assert.equal(r.status, "fail")
    assert.ok(r.failed.includes("tree-clean"))
    process.exitCode = prev // restaura p/ não falhar o runner
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
