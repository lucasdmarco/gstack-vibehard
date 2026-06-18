import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "security", "redact-proxy.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

function getFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}

test("redactBody: redige segredo no corpo completo", async () => {
  const { redactBody } = await imp()
  assert.match(redactBody("token sk_live_ABCD1234EFGH5678IJKL90 fim"), /\*\*\*REDACTED\*\*\*/)
  assert.ok(!redactBody("token sk_live_ABCD1234EFGH5678IJKL90").includes("sk_live_ABCD1234EFGH5678IJKL90"))
})

test("createRedactProxy: redige a RESPOSTA do upstream antes de devolver ao cliente", async () => {
  const { createRedactProxy } = await imp()
  // upstream fake que devolve um segredo
  const upstreamPort = await getFreePort()
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("resposta do modelo: sk_live_ABCD1234EFGH5678IJKL90 e ghp_" + "A".repeat(36) + "\n")
  })
  await new Promise((r) => upstream.listen(upstreamPort, r))

  const proxyPort = await getFreePort()
  let redactions = 0
  const proxy = createRedactProxy({ upstream: `http://localhost:${upstreamPort}`, port: proxyPort, onEvent: (e) => { redactions += e.redactions } })
  await proxy.listen()
  try {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${proxyPort}/v1/messages`, (res) => {
        let b = ""; res.on("data", (c) => b += c); res.on("end", () => resolve(b))
      }).on("error", reject)
    })
    assert.ok(!body.includes("sk_live_ABCD1234EFGH5678IJKL90"), "segredo NÃO chega ao cliente")
    assert.match(body, /\*\*\*REDACTED\*\*\*/)
    assert.ok(redactions >= 1, "evento de redação emitido")
  } finally {
    await proxy.close()
    await new Promise((r) => upstream.close(r))
  }
})

test("createRedactProxy: upstream obrigatório", async () => {
  const { createRedactProxy } = await imp()
  assert.throws(() => createRedactProxy({}), /upstream/)
})
