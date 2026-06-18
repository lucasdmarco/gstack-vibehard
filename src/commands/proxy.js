import { createRedactProxy } from "../security/redact-proxy.js"
import { success, warn, info, section } from "../cli/index.js"

/**
 * `gstack proxy` — sobe o proxy de redaction pré-output (opt-in). Interceptação
 * REAL em trânsito: o harness é apontado para este proxy e a resposta do modelo
 * é redigida antes de chegar à tela. Só funciona onde o harness aceita base-URL custom.
 */
export async function proxyCommand(args = [], opts = {}) {
  const pi = args.indexOf("--port")
  const port = pi !== -1 && args[pi + 1] ? parseInt(args[pi + 1], 10) : 8788
  const ui = args.indexOf("--upstream")
  const upstream = ui !== -1 && args[ui + 1] ? args[ui + 1] : "https://api.anthropic.com"

  section("gstack proxy — redaction pré-output (opt-in, interceptação real)")
  let redactions = 0
  const handle = createRedactProxy({ upstream, port, onEvent: (e) => { redactions += e.redactions } })

  if (opts.returnHandle) return handle // seam para testes (não bloqueia)

  await handle.listen()
  success(`Proxy ativo: http://localhost:${port}  →  ${upstream}`)
  info("Aponte o harness para este proxy (onde houver suporte a base-URL custom):")
  info(`  ANTHROPIC_BASE_URL=http://localhost:${port}`)
  info(`  OPENAI_BASE_URL=http://localhost:${port}/v1`)
  warn("Honesto: NÃO é universal (só harness que aceita base-URL); SSE é best-effort por linha.")
  info("Ctrl+C para parar.")
  process.on("SIGINT", async () => { await handle.close(); info(`\nProxy encerrado. Redações na sessão: ${redactions}`); process.exit(0) })
  // mantém o processo vivo (daemon)
  await new Promise(() => {})
}
