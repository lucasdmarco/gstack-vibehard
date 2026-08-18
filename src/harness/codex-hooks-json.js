/**
 * `~/.codex/hooks.json` — a ÚNICA autoridade de hooks do Codex no GStack.
 *
 * O contrato canônico, confirmado contra o binário 0.145.0 e contra um
 * `hooks.json` real:
 *
 *   { "hooks": { "<EventName>": [ { "matcher": "<regex>",
 *                                   "hooks": [ { "type": "command",
 *                                                "command": "...",
 *                                                "statusMessage": "...",
 *                                                "timeout": 30 } ] } ] } }
 *
 * `config.toml` NÃO participa disto. O bloco `[hooks.state]` de lá é LEDGER DE
 * CONFIANÇA (`enabled`, `trusted_hash`) — do Codex e do usuário, nunca nosso.
 * Escrever a mesma integração nos dois lugares criaria duas verdades sobre o
 * mesmo hook, e a segunda envelheceria calada; é por isso que o wiring legado de
 * `config.toml` saiu e não volta.
 *
 * CONFIANÇA NÃO SE FABRICA. Este módulo nunca emite `trusted_hash` nem toca
 * `hooks.state`: alterar o script INVALIDA a confiança por construção, e o Codex
 * volta a perguntar. Copiar um hash entre máquinas transformaria uma aprovação
 * dada numa máquina em autorização silenciosa noutra.
 */

export const CODEX_HOOKS_JSON_SCHEMA = "gstack.codex.hooks-json.v1"

/**
 * Os hooks que o GStack declara, e o evento de cada um.
 *
 * `PostToolUse` aponta para `post_tool_use_review.py`, e NÃO para `stop.py` —
 * era o defeito semântico do `P0.CODEX-HOOKS`: o hook de PostToolUse executava o
 * hook de Stop, aditivamente e em silêncio, enquanto o script certo existia e
 * nunca era registrado.
 */
export const GSTACK_CODEX_HOOKS = Object.freeze([
  Object.freeze({
    event: "SessionStart", matcher: "startup|resume", script: "session_start.py",
    statusMessage: "Carregando contexto do projeto e memórias", timeout: 60,
  }),
  Object.freeze({
    event: "PreToolUse", matcher: "^Bash$", script: "pre_tool_use_security.py",
    statusMessage: "Verificando segurança do comando", timeout: 30,
  }),
  Object.freeze({
    event: "PermissionRequest", matcher: "^Bash$", script: "permission_request.py",
    statusMessage: "Avaliando aprovação automática", timeout: 15,
  }),
  Object.freeze({
    event: "PostToolUse", matcher: "Write|Edit|apply_patch", script: "post_tool_use_review.py",
    statusMessage: "Revisando alteração", timeout: 15,
  }),
  Object.freeze({
    event: "UserPromptSubmit", matcher: ".*", script: "user_prompt_submit.py",
    statusMessage: "Sugerindo skills pelo prompt", timeout: 30,
  }),
  Object.freeze({
    event: "Stop", matcher: ".*", script: "stop.py",
    statusMessage: "Salvando memórias da sessão", timeout: 600,
  }),
])

/** Caminho POSIX do script instalado — o Codex recebe o comando pronto. */
const comandoDe = (script, hooksDir, pythonCmd) =>
  `${pythonCmd} "${`${hooksDir}/${script}`.replaceAll("\\", "/")}"`

/**
 * Uma entrada é NOSSA quando o comando aponta para um script que declaramos,
 * dentro do diretório de hooks do GStack.
 *
 * Identificar por CAMINHO e não por marcador: o schema do Codex não tem campo
 * livre, e inventar um faria o produto escrever chave que o consumidor não
 * reconhece — o erro que este P0 acabou de corrigir.
 */
export function ehEntradaDoGstack(entrada, hooksDir) {
  const dir = String(hooksDir || "").replaceAll("\\", "/")
  const nossos = new Set(GSTACK_CODEX_HOOKS.map((h) => h.script))
  return (entrada?.hooks || []).some((h) => {
    const cmd = String(h?.command || "").replaceAll("\\", "/")
    return dir.length > 0 && cmd.includes(dir) && [...nossos].some((s) => cmd.includes(`/${s}`))
  })
}

const entradaDoGstack = (h, hooksDir, pythonCmd) => ({
  matcher: h.matcher,
  hooks: [{
    type: "command",
    command: comandoDe(h.script, hooksDir, pythonCmd),
    statusMessage: h.statusMessage,
    timeout: h.timeout,
  }],
})

const doDocumento = (doc) => (doc && typeof doc === "object" && doc.hooks && typeof doc.hooks === "object")
  ? doc.hooks
  : {}

/**
 * Merge NÃO DESTRUTIVO.
 *
 * Para cada evento: mantém TODAS as entradas do usuário na ordem em que estavam,
 * remove as nossas antigas e acrescenta a atual. Reinstalar/atualizar substitui
 * só o que é nosso, e por isso é idempotente — a versão ingênua (append) criaria
 * uma entrada por instalação, e o hook rodaria N vezes.
 */
export function mergeGstackHooks(doc, { hooksDir, pythonCmd }) {
  const hooks = { ...doDocumento(doc) }
  for (const h of GSTACK_CODEX_HOOKS) {
    const doUsuario = (hooks[h.event] || []).filter((e) => !ehEntradaDoGstack(e, hooksDir))
    hooks[h.event] = [...doUsuario, entradaDoGstack(h, hooksDir, pythonCmd)]
  }
  return { ...(doc || {}), hooks }
}

/** Remove SÓ as entradas do GStack; evento que fica vazio some. */
export function stripGstackHooks(doc, { hooksDir }) {
  const origem = doDocumento(doc)
  const hooks = {}
  for (const [evento, entradas] of Object.entries(origem)) {
    const doUsuario = (entradas || []).filter((e) => !ehEntradaDoGstack(e, hooksDir))
    if (doUsuario.length > 0) hooks[evento] = doUsuario
  }
  const saida = { ...(doc || {}) }
  if (Object.keys(hooks).length > 0) saida.hooks = hooks
  else delete saida.hooks
  return saida
}

/** Itens de manifest das entradas que o GStack declara — ownership explícito. */
export function itensDeManifest(hooksJsonPath, { hooksDir, pythonCmd }) {
  return GSTACK_CODEX_HOOKS.map((h) => ({
    kind: "codex-hook-entry",
    path: hooksJsonPath,
    event: h.event,
    matcher: h.matcher,
    script: h.script,
    command: comandoDe(h.script, hooksDir, pythonCmd),
    removeOnUninstall: true,
  }))
}
