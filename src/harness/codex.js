import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { writeWithBackup, ensureDir } from "../installer/merge.js"
import { CHAVES_INERTES_ESCRITAS } from "./codex-hook-contract.js"

const HOME = homedir()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = dirname(__dirname)

const HOOKS_SOURCE = join(PACKAGE_ROOT, "hooks", "hooks")
const SKILLS_SOURCE = join(PACKAGE_ROOT, "skills", "skills")
const TEMPLATE_SOURCE = join(PACKAGE_ROOT, "templates", "templates")

function resolvePythonCmd() {
  try { execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 3000 }); return "python3" } catch { return "python" }
}

export async function installCodex(config, report) {
  const hooksDir = join(HOME, ".codex", "hooks")
  const configFile = join(HOME, ".codex", "config.toml")

  ensureDir(hooksDir)

  if (config.hooks) {
    const fs = await import("fs")
    const hooks = fs.readdirSync(HOOKS_SOURCE).filter((f) => f.endsWith(".py"))
    for (const hook of hooks) {
      const src = join(HOOKS_SOURCE, hook)
      const dst = join(hooksDir, hook)
      fs.copyFileSync(src, dst)
      report.added.push(`hook ${hook}`)
    }
  }

  if (config.template) {
    mergeCodexConfig(configFile, { mcp: !!config.mcp, mcpServers: config.mcpServers || null })
    report.updated.push(`~/.codex/config.toml (merge nao-destrutivo${config.mcp ? ", com MCP global" : ", sem MCP global"})`)
  }

  return report
}

/**
 * Tabelas/servidores MCP de propriedade do gstack — usados tanto no merge do
 * install quanto na limpeza do uninstall.
 */
export const GSTACK_MCP_SERVERS = [
  "fallow", "supabase", "playwright", "context7", "gbrain", "graphify", "headroom",
]
/**
 * Chaves que o GStack ja escreveu em `[hooks]` e agora apenas REMOVE.
 *
 * Derivadas do contrato, nao recopiadas: se a lista de chaves inertes mudar, a
 * limpeza acompanha sozinha.
 */
export const GSTACK_HOOK_KEYS = CHAVES_INERTES_ESCRITAS.map((c) => c.key)

function buildGstackConfig() {
  const skillsDir = join(HOME, ".agents", "skills").replaceAll("\\", "/")
  const hooksDirPosix = join(HOME, ".codex", "hooks").replaceAll("\\", "/")
  const pythonCmd = resolvePythonCmd()
  // `hooks` NAO e mais escrito. A confrontacao com o binario do Codex 0.145.0
  // (ver `codex-hook-contract.js`) mostrou que o bloco nunca teve como executar:
  // `on_session_start`/`on_stop` nao existem no Codex, o valor era array de
  // strings onde ele espera handler com `type`/`command`, e falta `trusted_hash`
  // -- sem o qual o proprio Codex avisa que "hooks won't run".
  //
  // Escrever configuracao INERTE no arquivo do usuario e pior que nao escrever:
  // dá aparencia de integracao ativa e polui o config. As chaves seguem
  // declaradas em `CHAVES_INERTES_ESCRITAS` para LIMPEZA de quem ja instalou.
  return {
    agent: {
      skills_dir: skillsDir,
      instructions: [
        "Comandos disponiveis:",
        "  /start      — PONTO DE ENTRADA guiado (objetivo -> plano -> execucao). Use primeiro.",
        "  /newproject — Guided Architecture Walkthrough (10 passos com design system)",
        "  /g_update   — Atualizar gstack_vibehard para versao mais recente",
        "",
        "Design System: ANTES de escrever frontend, pergunte se usuario tem DS proprio.",
        "Se nao perguntar, o hook pre_tool_use_security.py vai bloquear a escrita.",
        "",
        "Se ~/.gstack_vibehard/update_status.json mostrar latest > local, avise e sugira /g_update",
      ].join("\n"),
    },
    mcp_servers: {
      fallow: { command: "npx", args: ["-y", "fallow", "mcp"] },
      supabase: { command: "npx", args: ["-y", "@supabase/mcp-server", "--project-ref", "${SUPABASE_PROJECT_REF}"] },
      playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp", "--api-key", "${CONTEXT7_API_KEY}"] },
      gbrain: { command: "gbrain", args: ["serve"] },
      graphify: { command: resolvePythonCmd(), args: ["-m", "graphify.serve", "graphify-out/graph.json"] },
      headroom: { command: "headroom", args: ["mcp"] },
    },
  }
}

/**
 * Faz merge nao-destrutivo da config gstack no ~/.codex/config.toml.
 * - hooks: gstack vence (caminhos podem mudar entre versoes), mantem extras do usuario
 * - agent / mcp_servers: usuario vence (preserva customizacoes); gstack so adiciona o que falta
 * Exportada para teste com path injetavel.
 */
/**
 * Remove as chaves INERTES que o GStack escreveu em versoes anteriores,
 * preservando o que for do usuario. Devolve `null` quando nao sobra nada.
 *
 * O comando do usuario dentro de uma chave inerte E preservado: a chave nao
 * funciona, mas apagar o que outra pessoa escreveu seria destruir trabalho
 * alheio para limpar sujeira nossa.
 */
const comandosDoUsuario = (valor) =>
  toArray(valor).filter((c) => !(typeof c === "string" && isGstackHookCmd(c)))

/** Objeto sem as chaves vazias — `null` quando nao sobra nada. */
const ouNulo = (obj) => (Object.keys(obj).length > 0 ? obj : null)

function limparHooksInertes(hooks) {
  if (!hooks || typeof hooks !== "object") return null
  const saida = { ...hooks }
  for (const k of GSTACK_HOOK_KEYS.filter((x) => x in saida)) {
    const doUsuario = comandosDoUsuario(saida[k])
    if (doUsuario.length > 0) saida[k] = doUsuario
    else delete saida[k]
  }
  return ouNulo(saida)
}

/**
 * `mcp_servers` do merge, ou `null` quando nao ha nada a escrever.
 *
 * OPT-IN (P0.3): sem `mcp`, o GStack nao injeta servidor nenhum -- so preserva
 * os do usuario. Com `mcp`, adiciona os defaults (filtrados quando o usuario
 * escolheu servidores especificos), e o usuario vence em nome repetido.
 */
/**
 * Le o `config.toml`, ou `{}` quando ausente/corrompido.
 *
 * No MERGE, config corrompida vira `{}` e o gstack parte do zero -- o `.bak` do
 * `writeWithBackup` preserva o original. No STRIP a decisao e OPOSTA (aborta sem
 * escrever), e a diferenca e proposital: escrever config nova e util, mas apagar
 * config quebrada do usuario para limpar sujeira nossa seria pior que a sujeira.
 */
function lerConfigTolerante(configFile, readImpl) {
  if (!existsSync(configFile)) return {}
  try {
    return parseToml(readImpl(configFile, "utf-8")) || {}
  } catch {
    return {}
  }
}

function resolverMcpServers(gstack, existing, mcp, mcpServers) {
  if (!mcp) return existing.mcp_servers || null
  const escolhidos = Array.isArray(mcpServers) && mcpServers.length
  const add = escolhidos
    ? Object.fromEntries(Object.entries(gstack.mcp_servers).filter(([k]) => mcpServers.includes(k)))
    : gstack.mcp_servers
  return { ...add, ...(existing.mcp_servers || {}) }
}

export function mergeCodexConfig(configFile, opts = {}) {
  const { mcp = false, mcpServers = null, readImpl = readFileSync, writeImpl = writeWithBackup } = opts
  const gstack = buildGstackConfig()
  const existing = lerConfigTolerante(configFile, readImpl)
  const merged = { ...existing }
  // hooks: o GStack NAO escreve mais nenhum. O que este bloco faz agora e
  // LIMPAR o que versoes anteriores escreveram -- chaves que o Codex nunca
  // reconheceu --, preservando integralmente o que for do usuario.
  //
  // Roda no MERGE e nao so no uninstall de proposito: quem ja instalou so passa
  // por aqui, e deixar a configuracao inerte na maquina dele seria manter a
  // aparencia de integracao ativa que este achado desfez.
  const hooksLimpos = limparHooksInertes(existing.hooks)
  if (hooksLimpos) merged.hooks = hooksLimpos
  else delete merged.hooks
  // agent: usuario vence
  merged.agent = { ...gstack.agent, ...(existing.agent || {}) }
  // mcp_servers: OPT-IN (P0.3). Sem `mcp`, NÃO injeta servidores gstack — só
  // preserva os do usuario. Com `mcp`, adiciona os defaults (filtrados por
  // `mcpServers` quando o usuario escolheu servidores específicos); usuario vence.
  const servidores = resolverMcpServers(gstack, existing, mcp, mcpServers)
  if (servidores) merged.mcp_servers = servidores

  writeImpl(configFile, stringifyToml(merged))
}

function toArray(v) {
  if (Array.isArray(v)) return v
  return v != null ? [v] : []
}

const GSTACK_HOOK_SCRIPTS = [
  "session_start.py", "stop.py", "pre_tool_use_security.py",
]
function isGstackHookCmd(cmd) {
  return GSTACK_HOOK_SCRIPTS.some((s) => cmd.includes(s)) || cmd.includes(".gstack")
}

/**
 * Remove apenas as chaves de propriedade do gstack do config.toml, preservando
 * todo o restante. Usada pelo uninstall.
 */
/** Grava o valor limpo, ou remove a chave quando nao sobrou nada dela. */
function aplicarOuRemover(obj, chave, valor) {
  if (valor) obj[chave] = valor
  else delete obj[chave]
}

/** Servidores gstack que o usuario NAO customizou — so esses saem. */
function limparMcpServersGstack(existentes, defaults) {
  const saida = { ...existentes }
  for (const nome of GSTACK_MCP_SERVERS) {
    if (!(nome in saida)) continue
    const igualAoDefault = JSON.stringify(saida[nome]) === JSON.stringify(defaults[nome])
    if (igualAoDefault) delete saida[nome]
  }
  return ouNulo(saida)
}

/**
 * Remove do `config.toml` apenas o que e do gstack, preservando todo o resto.
 *
 * Config ilegivel NAO e sobrescrita as cegas: devolve `false` e sai. Config do
 * usuario quebrada e problema dele, e destrui-la para limpar sujeira nossa seria
 * pior que o problema.
 */
export function stripGstackFromCodexConfig(configFile, readImpl = readFileSync, writeImpl = writeWithBackup) {
  if (!existsSync(configFile)) return false
  let parsed
  try {
    parsed = parseToml(readImpl(configFile, "utf-8")) || {}
  } catch {
    return false
  }

  aplicarOuRemover(parsed, "hooks", limparHooksInertes(parsed.hooks))
  aplicarOuRemover(parsed, "mcp_servers",
    parsed.mcp_servers ? limparMcpServersGstack(parsed.mcp_servers, buildGstackConfig().mcp_servers) : null)

  writeImpl(configFile, stringifyToml(parsed))
  return true
}

