import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { gzipSync } from "node:zlib"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.4 (P1.6) — o redact-proxy não era seguro para tráfego real:
//   • server.listen(port) sem fixar loopback → bind em TODAS as interfaces (exposto na rede);
//   • repassa TODOS os headers (hop-by-hop e sensíveis) do cliente ao upstream;
//   • setEncoding("utf8") preservando content-encoding → body gzip CORROMPE no cliente;
//   • redação SSE por LINHA → segredo partido entre chunks atravessa;
//   • sem health endpoint (outro processo na porta é confundido com o proxy).
// Hardening: bind exclusivo 127.0.0.1, health com nonce, filtro de headers, accept-encoding
// identity + strip de content-encoding, rolling-window na redação, timeouts/limites.

const mod = path.resolve(import.meta.dirname, "..", "src", "security", "redact-proxy.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })
const GET = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get(url, { headers }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b })) }).on("error", reject)
})

async function withProxy(upstreamHandler, run, proxyOpts = {}) {
  const upstreamPort = await freePort()
  const upstream = http.createServer(upstreamHandler)
  await new Promise((r) => upstream.listen(upstreamPort, "127.0.0.1", r))
  const proxyPort = await freePort()
  const { createRedactProxy } = await imp()
  const proxy = createRedactProxy({ upstream: `http://127.0.0.1:${upstreamPort}`, port: proxyPort, ...proxyOpts })
  await proxy.listen()
  try { return await run(proxy, proxyPort) } finally { await proxy.close(); await new Promise((r) => upstream.close(r)) }
}

test("bind EXCLUSIVO em 127.0.0.1 (nunca 0.0.0.0 — não exposto na rede)", async () => {
  const { createRedactProxy } = await imp()
  const proxy = createRedactProxy({ upstream: "http://127.0.0.1:9", port: await freePort() })
  assert.equal(proxy.host, "127.0.0.1", "host de bind é loopback")
  await proxy.listen()
  try {
    const addr = proxy.server.address()
    assert.equal(addr.address, "127.0.0.1", "CONTROLE NEGATIVO: não faz bind em 0.0.0.0/::")
  } finally { await proxy.close() }
})

test("health endpoint com NONCE: só responde ok com o nonce certo (anti-confusão de porta)", async () => {
  await withProxy((req, res) => res.end("x"), async (proxy, port) => {
    assert.match(proxy.healthNonce, /^[0-9a-f]{16,}$/, "nonce imprevisível")
    const ok = await GET(`http://127.0.0.1:${port}/__gstack/health?nonce=${proxy.healthNonce}`)
    assert.equal(ok.status, 200)
    assert.match(ok.body, /gstack-redact-proxy/, "identifica o proxy")
    // CONTROLE NEGATIVO: nonce errado não é reconhecido como nosso health.
    const bad = await GET(`http://127.0.0.1:${port}/__gstack/health?nonce=errado`)
    assert.notEqual(bad.status, 200, "nonce inválido não confirma o proxy")
  })
})

test("body GZIP do upstream NÃO corrompe: força identity e faz strip de content-encoding", async () => {
  const secret = "sk_live_ABCD1234EFGH5678IJKL90"
  await withProxy((req, res) => {
    // upstream 'respeita' accept-encoding: sem identity ele mandaria gzip.
    const wantsIdentity = /identity/.test(req.headers["accept-encoding"] || "")
    if (wantsIdentity) { res.writeHead(200, { "content-type": "text/plain" }); res.end(`resp ${secret} fim\n`) }
    else { res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" }); res.end(gzipSync(`resp ${secret} fim\n`)) }
  }, async (_proxy, port) => {
    const r = await GET(`http://127.0.0.1:${port}/v1/x`)
    assert.equal(r.headers["content-encoding"], undefined, "content-encoding removido (body já é texto plano)")
    assert.ok(!r.body.includes(secret), "segredo redigido")
    assert.match(r.body, /resp .*REDACTED.* fim/, "body legível (não corrompido por gzip)")
  })
})

test("rolling-window: segredo PARTIDO entre chunks é redigido (não atravessa)", async () => {
  const secret = "sk_live_ABCD1234EFGH5678IJKL90"
  const a = secret.slice(0, 10), b = secret.slice(10)
  await withProxy((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.write(`data: inicio ${a}`)
    setTimeout(() => { res.write(`${b} resto\n`); res.end() }, 20)
  }, async (_proxy, port) => {
    const r = await GET(`http://127.0.0.1:${port}/v1/stream`)
    assert.ok(!r.body.includes(secret), "CONTROLE NEGATIVO: segredo dividido em 2 chunks NÃO atravessa")
    assert.match(r.body, /REDACTED/)
  })
})

test("headers hop-by-hop são filtrados; accept-encoding vira identity; auth do cliente passa", async () => {
  let seen = {}
  await withProxy((req, res) => { seen = req.headers; res.end("ok") }, async (_proxy, port) => {
    await GET(`http://127.0.0.1:${port}/v1/x`, { "proxy-authorization": "Basic zzz", "x-api-key": "sk-cliente" })
    // hop-by-hop de proxy não trafega fim-a-fim.
    assert.equal(seen["proxy-authorization"], undefined, "hop-by-hop `proxy-authorization` filtrado")
    // pedimos SEM compressão para poder redigir texto plano.
    assert.match(seen["accept-encoding"] || "", /identity/, "accept-encoding forçado identity")
    // a credencial de API do cliente DEVE chegar ao upstream — é como o harness autentica.
    assert.equal(seen["x-api-key"], "sk-cliente", "auth do cliente é repassada (não é vazamento)")
  })
})

test("resposta não-stream continua redigida (contrato preservado)", async () => {
  const secret = "ghp_" + "A".repeat(36)
  await withProxy((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(`{"t":"${secret}"}`) },
    async (_proxy, port) => {
      const r = await GET(`http://127.0.0.1:${port}/v1/x`)
      assert.ok(!r.body.includes(secret), "segredo redigido em corpo completo")
    })
})
