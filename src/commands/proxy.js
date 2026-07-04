import { createRedactProxy } from "../security/redact-proxy.js"
import { buildGuardStatus, DEFAULT_PROXY_PORT } from "../security/guard-status.js"
import { success, warn, info, section } from "../cli/index.js"

function renderGuardHuman(st) {
  section("proxy status — Output Guard (cobertura honesta)")
  info(`  Pós-resposta: SEMPRE ativa — ${st.posthoc.note}`)
  const pr = st.preRender
  const proxyLabel = pr.proxyRunning ? `ATIVO na porta ${pr.port}` : "inativo"
  info(`  Pré-render (opt-in): proxy ${proxyLabel} · env apontando: anthropic=${pr.envPointing.anthropic} openai=${pr.envPointing.openai}`)
  const partial = st.coverage === "pre_render_partial"
  ;(partial ? success : warn)(`  Cobertura atual: ${st.coverage}${partial ? "" : " — para redação EM TRÂNSITO: `gstack_vibehard proxy`"}`)
  info("  Interceptação por harness (sem promessa falsa):")
  for (const m of st.matrix) info(`   ${m.preRender ? "▲" : "•"} ${m.harness}: ${m.how}`)
}

const flagValue = (args, name) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const parsePort = (args) => { const v = flagValue(args, "--port"); return v ? parseInt(v, 10) : DEFAULT_PROXY_PORT }

/** `proxy status [--json]` — cobertura HONESTA do Output Guard (pós-resposta vs pré-render). */
async function proxyStatus(args, opts) {
  const port = parsePort(args)
  const st = await buildGuardStatus({ port, env: opts.env, probe: opts.probe, fetchImpl: opts.fetchImpl })
  if (args.includes("--json")) { process.stdout.write(JSON.stringify(st) + "\n"); return st }
  renderGuardHuman(st)
  return st
}

/**
 * `gstack proxy [status]` — sobe o proxy de redaction pré-output (opt-in). Interceptação
 * REAL em trânsito: o harness é apontado para este proxy e a resposta do modelo
 * é redigida antes de chegar à tela. Só funciona onde o harness aceita base-URL custom.
 */
export async function proxyCommand(args = [], opts = {}) {
  if (args.find((a) => !a.startsWith("-")) === "status") return proxyStatus(args, opts)
  const port = parsePort(args)
  const upstream = flagValue(args, "--upstream") || "https://api.anthropic.com"

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
