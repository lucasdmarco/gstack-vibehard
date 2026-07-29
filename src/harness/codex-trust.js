import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { parse as parseToml } from "smol-toml"

/**
 * PRD51 S51.7.7 — estado de confiança dos hooks do Codex (READ-ONLY).
 *
 * O cenário 6 do PRD49 ("hook do Codex não-confiável reporta aguardando
 * aprovação") estava `not_executed` porque o repo assumia que não existia
 * nenhum conceito real de "ambiente confiável". Investigando o Codex CLI
 * instalado nesta máquina, ele EXISTE e é do próprio Codex, não nosso:
 * `~/.codex/config.toml` carrega uma tabela `[hooks.state]` cujas chaves são
 * `<arquivo-de-hooks>:<evento>:<grupo>:<hook>` e cujo valor é
 * `trusted_hash = "sha256:..."` — o registro de que o usuário aprovou aquele
 * hook. Hook sem entrada em `[hooks.state]` nunca foi aprovado.
 *
 * LIMITE HONESTO, verificado empiricamente e NÃO contornado aqui: a entrada
 * exata do sha256 do Codex é interna e não documentada. Testei 5 candidatos
 * plausíveis contra os hashes reais desta máquina (string do comando, JSON da
 * entrada em 3 formatações, JSON do grupo) e NENHUM bateu. Portanto este
 * módulo NUNCA recomputa nem valida o hash: `trust: "recorded"` significa
 * "o usuário aprovou ALGUMA versão deste hook", jamais "esta versão exata
 * está aprovada". Fingir o contrário seria inventar prova.
 */
export const CODEX_TRUST_SCHEMA = "gstack.codex-trust.v1"

/** O que sabemos e o que NÃO sabemos — vai junto no payload, nunca só no comentário. */
export const CODEX_TRUST_LIMITS = Object.freeze({
  hashRecomputable: false,
  reason: "a entrada do sha256 de `trusted_hash` é interna do Codex CLI e não documentada; 5 candidatos plausíveis foram testados contra hashes reais e nenhum bateu",
  meaning: "`recorded` = o usuário aprovou alguma versão do hook; NÃO prova que a versão atual em disco é a aprovada",
})

const GSTACK_HOOK_SCRIPTS = ["session_start.py", "stop.py", "pre_tool_use_security.py", "post_tool_use_review.py", "permission_request.py"]
const isGstackCommand = (cmd) => typeof cmd === "string" && (GSTACK_HOOK_SCRIPTS.some((s) => cmd.includes(s)) || cmd.includes(".gstack"))

export const codexConfigPath = (home = homedir()) => join(home, ".codex", "config.toml")
export const codexHooksPath = (home = homedir()) => join(home, ".codex", "hooks.json")

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } }
const readToml = (p) => { try { return parseToml(readFileSync(p, "utf-8")) || {} } catch { return null } }

/**
 * Chaves de `[hooks.state]` no formato `<arquivo>:<evento>:<grupo>:<hook>`.
 * O arquivo é um caminho Windows com `:` no drive, então os 3 últimos campos
 * é que importam — split pela DIREITA, nunca pela esquerda.
 */
export function parseTrustStateKey(key) {
  const parts = String(key).split(":")
  if (parts.length < 4) return null
  const [event, group, hook] = parts.slice(-3)
  const hooksFile = parts.slice(0, -3).join(":")
  if (!/^\d+$/.test(group) || !/^\d+$/.test(hook)) return null
  return { hooksFile, event, groupIndex: Number(group), hookIndex: Number(hook) }
}

/** `[hooks.state]` -> lista normalizada. Ausente/ilegível -> []. */
export function parseTrustState(config) {
  const state = config?.hooks?.state
  if (!state || typeof state !== "object") return []
  return Object.entries(state).flatMap(([key, value]) => {
    const parsed = parseTrustStateKey(key)
    return parsed ? [{ key, ...parsed, trustedHash: value?.trusted_hash || null }] : []
  })
}

/** Achata `hooks.json` em uma lista de hooks endereçáveis (evento + índices). */
export function enumerateCodexHooks(hooksJson) {
  const groups = hooksJson?.hooks
  if (!groups || typeof groups !== "object") return []
  return Object.entries(groups).flatMap(([event, list]) =>
    (Array.isArray(list) ? list : []).flatMap((group, groupIndex) =>
      (Array.isArray(group?.hooks) ? group.hooks : []).map((h, hookIndex) => ({
        event, groupIndex, hookIndex, command: h?.command || null, gstackOwned: isGstackCommand(h?.command),
      }))))
}

// O Codex grava o evento em snake_case na chave de estado (`pre_tool_use`) e em
// PascalCase no hooks.json (`PreToolUse`) — confirmado lendo os dois arquivos
// reais desta máquina. Comparar sem normalizar daria "nunca aprovado" pra tudo.
const normEvent = (e) => String(e).replaceAll("_", "").toLowerCase()
const sameSlot = (a, b) => normEvent(a.event) === normEvent(b.event) && a.groupIndex === b.groupIndex && a.hookIndex === b.hookIndex

/**
 * Estado de confiança por hook. `awaiting_user_trust` é o caso do cenário 6 do
 * PRD49: o hook existe em disco mas o Codex nunca registrou aprovação dele.
 */
export function codexTrustStatus(opts = {}) {
  const configPath = opts.configPath || codexConfigPath()
  const hooksPath = opts.hooksPath || codexHooksPath()
  const config = existsSync(configPath) ? readToml(configPath) : null
  const hooksJson = existsSync(hooksPath) ? readJson(hooksPath) : null
  const recorded = parseTrustState(config)
  const hooks = enumerateCodexHooks(hooksJson)
  const entries = hooks.map((h) => {
    const match = recorded.find((r) => sameSlot(r, h))
    return { ...h, trust: match ? "recorded" : "awaiting_user_trust", trustedHash: match?.trustedHash || null }
  })
  // Aprovação registrada apontando pra um slot que não existe mais (hook
  // removido/reordenado): a aprovação antiga NÃO cobre o que está lá agora.
  const orphanTrust = recorded.filter((r) => !hooks.some((h) => sameSlot(r, h))).map((r) => r.key)
  return {
    schemaVersion: CODEX_TRUST_SCHEMA,
    configPath, hooksPath,
    configFound: config !== null,
    hooksFound: hooksJson !== null,
    entries,
    orphanTrust,
    counts: {
      total: entries.length,
      gstackOwned: entries.filter((e) => e.gstackOwned).length,
      recorded: entries.filter((e) => e.trust === "recorded").length,
      awaitingUserTrust: entries.filter((e) => e.trust === "awaiting_user_trust").length,
      orphanTrust: orphanTrust.length,
    },
    limits: CODEX_TRUST_LIMITS,
  }
}

/** Só os hooks do gstack que ainda esperam aprovação do usuário. */
export const awaitingUserTrust = (status) => status.entries.filter((e) => e.gstackOwned && e.trust === "awaiting_user_trust")

/**
 * Veredito legível. `trusted_environment` exige: config + hooks lidos, pelo
 * menos um hook gstack presente, nenhum deles aguardando aprovação e nenhuma
 * aprovação órfã. Nunca promete que o hash confere — ver CODEX_TRUST_LIMITS.
 */
export function codexTrustVerdict(status) {
  if (!status.hooksFound) return { verdict: "codex_not_configured", reason: "hooks.json do Codex ausente ou ilegível nesta máquina" }
  const gstack = status.entries.filter((e) => e.gstackOwned)
  if (gstack.length === 0) return { verdict: "gstack_hooks_absent", reason: "nenhum hook do gstack registrado no hooks.json do Codex" }
  const pending = gstack.filter((e) => e.trust === "awaiting_user_trust")
  if (pending.length) return { verdict: "awaiting_user_trust", reason: `${pending.length} hook(s) gstack sem aprovação registrada`, pending: pending.map((e) => e.event) }
  if (status.orphanTrust.length) return { verdict: "trust_stale", reason: `${status.orphanTrust.length} aprovação(ões) registrada(s) apontam para hooks que não existem mais` }
  return { verdict: "trusted_environment", reason: `${gstack.length} hook(s) gstack com aprovação registrada`, caveat: CODEX_TRUST_LIMITS.meaning }
}
