import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "commands", "update.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function captureJson(fn) {
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { buf += String(s); return true }
  return fn().finally(() => { process.stdout.write = orig }).then(() => JSON.parse(buf.trim()))
}

test("update --json: detecta atualização disponível (latest > local)", async () => {
  const { updateCommand } = await imp()
  const exec = () => "9.9.9" // npm view retorna a última
  const r = await captureJson(() => updateCommand(["--json"], { exec, localVersion: "3.0.13" }))
  assert.equal(r.local, "3.0.13")
  assert.equal(r.latest, "9.9.9")
  assert.equal(r.updateAvailable, true)
  assert.match(r.command, /npm install -g @gstack-vibehard\/installer@latest/)
})

test("update --json: já atualizado (latest == local)", async () => {
  const { updateCommand } = await imp()
  const r = await captureJson(() => updateCommand(["--json"], { exec: () => "3.0.13", localVersion: "3.0.13" }))
  assert.equal(r.updateAvailable, false)
})

test("update --json: sem rede (npm view falha) → latest null, não quebra", async () => {
  const { updateCommand } = await imp()
  const exec = () => { throw new Error("offline") }
  const r = await captureJson(() => updateCommand(["--json"], { exec, localVersion: "3.0.13" }))
  assert.equal(r.latest, null)
  assert.equal(r.updateAvailable, false)
})
