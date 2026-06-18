import http from "http"
import https from "https"
import { URL } from "url"
import { redactSecrets } from "./redact.js"

/**
 * Proxy reverso OPT-IN de redaction PRÉ-OUTPUT (PRD Fase 3 §4 — caminho honesto).
 *
 * É a ÚNICA forma real de "interceptação em trânsito" a partir de uma CLly: o
 * harness é apontado para este proxy local (ANTHROPIC_BASE_URL / OPENAI_BASE_URL)
 * e a RESPOSTA do modelo é redigida ANTES de voltar pro harness/tela.
 *
 * Honestidade (sem placebo):
 *  - Só funciona onde o harness aceita base-URL custom. NÃO é universal nem forçável.
 *  - Redaction de stream (SSE) é por LINHA (best-effort: segredo partido entre chunks
 *    pode escapar); resposta não-stream é redigida por completo.
 *  - Não é "impossível de hackear" — é uma defesa real a mais, opt-in.
 */

/** Redige um corpo completo (não-stream). Reusa a lib única. */
export function redactBody(text) {
  return redactSecrets(text).redacted
}

export function createRedactProxy(opts = {}) {
  if (!opts.upstream) throw new Error("createRedactProxy: upstream obrigatório")
  const target = new URL(opts.upstream)
  const port = opts.port || 8788
  const onEvent = opts.onEvent || (() => {})
  const lib = target.protocol === "https:" ? https : http

  const server = http.createServer((req, res) => {
    const upReq = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    }, (upRes) => {
      const headers = { ...upRes.headers }
      delete headers["content-length"] // o tamanho muda após redação
      res.writeHead(upRes.statusCode || 502, headers)
      let partial = ""
      upRes.setEncoding("utf8")
      upRes.on("data", (chunk) => {
        partial += chunk
        const lines = partial.split("\n")
        partial = lines.pop() // guarda a linha incompleta p/ o próximo chunk
        for (const line of lines) {
          const { redacted, count } = redactSecrets(line)
          if (count) onEvent({ redactions: count })
          res.write(redacted + "\n")
        }
      })
      upRes.on("end", () => {
        if (partial) {
          const { redacted, count } = redactSecrets(partial)
          if (count) onEvent({ redactions: count })
          res.write(redacted)
        }
        res.end()
      })
    })
    upReq.on("error", (e) => { res.writeHead(502); res.end(`gstack redact-proxy: upstream error: ${e.message}`) })
    req.pipe(upReq)
  })

  return {
    server,
    port,
    listen: () => new Promise((resolve) => server.listen(port, () => resolve(port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
