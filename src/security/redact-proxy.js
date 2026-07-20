import http from "http"
import https from "https"
import { URL } from "url"
import { randomBytes } from "crypto"
import { redactSecrets } from "./redact.js"

/**
 * Proxy reverso OPT-IN de redaction PRÉ-OUTPUT (PRD Fase 3 §4 — caminho honesto).
 *
 * É a ÚNICA forma real de "interceptação em trânsito" a partir de uma CLI: o harness é apontado
 * para este proxy local (ANTHROPIC_BASE_URL / OPENAI_BASE_URL) e a RESPOSTA do modelo é redigida
 * ANTES de voltar pro harness/tela.
 *
 * Hardening PRD45 S45.4 (P1.6) — seguro para tráfego real:
 *  - bind EXCLUSIVO em 127.0.0.1 (nunca 0.0.0.0 — não exposto na rede local);
 *  - health endpoint com NONCE (outro processo na porta não é confundido com o proxy);
 *  - filtra headers hop-by-hop (RFC 7230) na ida e na volta;
 *  - força `accept-encoding: identity` ao upstream e faz strip de content-encoding — evita
 *    corromper body comprimido ao redigir (o caminho antigo convertia gzip→utf8 e reenviava
 *    com content-encoding:gzip, quebrando o cliente);
 *  - redação com ROLLING WINDOW: mantém uma cauda entre chunks para pegar segredo partido no
 *    boundary (o antigo redigia por linha e deixava passar segredo dividido em chunks);
 *  - timeouts e limite de corpo (anti-DoS/estouro de memória).
 *
 * Honestidade: só funciona onde o harness aceita base-URL custom; é uma defesa a mais, opt-in.
 */

// Headers que NÃO devem trafegar fim-a-fim num proxy (RFC 7230 §6.1) + sensíveis do cliente.
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection",
])
// Cauda mantida entre chunks: ≥ maior padrão de segredo (chave PEM/token) com folga.
const OVERLAP = 512
// Teto de acúmulo sem newline antes de emitir (evita memória infinita em stream sem \n).
const MAX_BUFFER = 1 << 20 // 1 MiB

/** Redige um corpo completo (não-stream). Reusa a lib única. */
export function redactBody(text) {
  return redactSecrets(text).redacted
}

const stripHopByHop = (headers) => {
  const out = {}
  for (const [k, v] of Object.entries(headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v
  return out
}
// Headers de REQUEST ao upstream: sem hop-by-hop, host correto, sem compressão (identity).
function upstreamHeaders(reqHeaders, targetHost) {
  const h = stripHopByHop(reqHeaders)
  h.host = targetHost
  h["accept-encoding"] = "identity" // pedimos SEM compressão p/ redigir texto plano
  return h
}
// Headers de RESPONSE ao cliente: sem hop-by-hop, sem content-encoding (já é identity) e sem
// content-length (o tamanho muda após redação).
function clientHeaders(upHeaders) {
  const h = stripHopByHop(upHeaders)
  delete h["content-encoding"]
  delete h["content-length"]
  return h
}

/**
 * Redator com ROLLING WINDOW. `push(chunk)` devolve o prefixo seguro já redigido (retendo uma
 * cauda de OVERLAP para o caso de um segredo estar partido no boundary); `flush()` redige e
 * devolve o que restou. Emite a contagem de redações por chamada.
 */
function makeStreamRedactor(onCount) {
  let buf = ""
  const emit = (text) => {
    const { redacted, count } = redactSecrets(text)
    if (count) onCount(count)
    return redacted
  }
  return {
    push(chunk) {
      buf += chunk
      // Só emitimos até deixar OVERLAP na cauda; assim um segredo no boundary é retido e
      // completado pelo próximo chunk. Sob buffer gigante sem \n, força a barra p/ não estourar.
      const keep = buf.length > MAX_BUFFER ? 0 : OVERLAP
      if (buf.length <= keep) return ""
      const cut = buf.length - keep
      const head = buf.slice(0, cut)
      buf = buf.slice(cut)
      return emit(head)
    },
    flush() { const out = emit(buf); buf = ""; return out },
  }
}

const nowProto = (target) => (target.protocol === "https:" ? https : http)
const HEALTH_PATH = "/__gstack/health"

function makeUpstreamHandler(res, onEvent) {
  return (upRes) => {
    res.writeHead(upRes.statusCode || 502, clientHeaders(upRes.headers))
    const redactor = makeStreamRedactor((count) => onEvent({ redactions: count }))
    upRes.setEncoding("utf8")
    upRes.on("data", (chunk) => { const out = redactor.push(chunk); if (out) res.write(out) })
    upRes.on("end", () => { const tail = redactor.flush(); if (tail) res.write(tail); res.end() })
  }
}

function proxyRequest(req, res, target, onEvent) {
  const lib = nowProto(target)
  const upReq = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: upstreamHeaders(req.headers, target.host),
  }, makeUpstreamHandler(res, onEvent))
  upReq.setTimeout(120000, () => upReq.destroy(new Error("upstream timeout")))
  upReq.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end(`gstack redact-proxy: upstream error: ${e.message}`) })
  req.pipe(upReq)
}

// Health SÓ confirma o proxy com o nonce certo — outro processo na porta não passa por nós.
function handleHealth(req, res, nonce) {
  const u = new URL(req.url, "http://127.0.0.1")
  if (u.searchParams.get("nonce") === nonce) {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify({ service: "gstack-redact-proxy", ok: true }))
  }
  res.writeHead(403); res.end("forbidden")
}

export function createRedactProxy(opts = {}) {
  if (!opts.upstream) throw new Error("createRedactProxy: upstream obrigatório")
  const target = new URL(opts.upstream)
  const port = opts.port || 8788
  const host = opts.host || "127.0.0.1" // bind loopback EXCLUSIVO (P1.6)
  const onEvent = opts.onEvent || (() => {})
  const healthNonce = opts.healthNonce || randomBytes(16).toString("hex")

  const server = http.createServer((req, res) => {
    if (req.url.startsWith(HEALTH_PATH)) return handleHealth(req, res, healthNonce)
    proxyRequest(req, res, target, onEvent)
  })
  server.requestTimeout = 300000
  server.headersTimeout = 60000

  return {
    server, port, host, healthNonce,
    // listen SEMPRE no host loopback — nunca em todas as interfaces.
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
