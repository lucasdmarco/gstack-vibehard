import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const doctorModule = path.join(repoRoot, "src", "printing-press", "doctor.js")

function execFactory({ version = true, help = true, auth = true } = {}) {
  return (bin, args) => {
    const a = args.join(" ")
    if (a === "--version") { if (version) return Buffer.from("1.0"); throw new Error("x") }
    if (a === "--help") { if (help) return Buffer.from("help"); throw new Error("x") }
    if (a === "auth doctor") { if (auth) return Buffer.from("ok"); throw new Error("x") }
    throw new Error("unexpected")
  }
}

test("doctorTool: binario ausente -> error", async () => {
  const { doctorTool } = await import(`${pathToFileURL(doctorModule)}?t=${Date.now()}`)
  const r = doctorTool({ name: "stripe", cli: "stripe-pp-cli" }, { exec: execFactory({ version: false }) })
  assert.equal(r.binary, false)
  assert.equal(r.status, "error")
})

test("doctorTool: tudo ok + mcp habilitado -> ok", async () => {
  const { doctorTool } = await import(`${pathToFileURL(doctorModule)}?t=${Date.now()}`)
  const r = doctorTool({ name: "stripe", cli: "stripe-pp-cli", provenance: ".printing-press.json" },
    { exec: execFactory({}), mcpEnabled: true })
  assert.equal(r.binary, true)
  assert.equal(r.auth, "ok")
  assert.equal(r.mcp, "enabled")
  assert.equal(r.provenance, true)
  assert.equal(r.status, "ok")
})

test("doctorTool: auth ausente ou mcp off -> warning (nao error)", async () => {
  const { doctorTool } = await import(`${pathToFileURL(doctorModule)}?t=${Date.now()}`)
  const r = doctorTool({ name: "stripe", cli: "stripe-pp-cli" },
    { exec: execFactory({ auth: false }), mcpEnabled: false })
  assert.equal(r.binary, true)
  assert.equal(r.status, "warning")
})

test("doctorAll cruza installed com mcp do registry", async () => {
  const { doctorAll } = await import(`${pathToFileURL(doctorModule)}?t=${Date.now()}`)
  const registry = {
    printingPress: {
      installed: [{ name: "stripe", cli: "stripe-pp-cli", provenance: ".printing-press.json" }],
      mcp: ["pp-stripe"],
    },
  }
  const results = doctorAll(registry, { exec: execFactory({}) })
  assert.equal(results.length, 1)
  assert.equal(results[0].mcp, "enabled")
  assert.equal(results[0].status, "ok")
})
