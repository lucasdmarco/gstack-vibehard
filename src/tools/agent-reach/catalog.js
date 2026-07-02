/**
 * Agent Reach — catálogo de CANAIS por grupo (PRD14 §4.15). O Agent Reach é uma
 * capability layer EXTERNA de leitura/pesquisa na internet; o gstack só governa
 * a SELEÇÃO consentida, o registro e o doctor. Regras de segurança:
 *
 *  - default seguro: só `core` (zero-config) entra sem pergunta explícita;
 *  - canal com cookie/login NUNCA entra por default e exige consentimento POR CANAL;
 *  - cookies/tokens nunca vão para .env/.gstack/logs/journal — ficam no storage
 *    do próprio Agent Reach ou no secrets broker;
 *  - backend externo ausente = `external_engine_unavailable` (nunca OK falso).
 */

export const GROUPS = Object.freeze(["core", "search", "social", "professional"])

const CH = (id, group, def) => ({ id, group, zeroConfig: false, requires: [], riskNotes: [], ...def })

export const CHANNELS = Object.freeze([
  // core: zero-config, sem credencial — únicos elegíveis ao default
  CH("web-reader", "core", { zeroConfig: true, label: "Web/Jina Reader (páginas → texto)" }),
  CH("youtube", "core", { zeroConfig: true, label: "YouTube (transcrição/metadata pública)" }),
  CH("github-public", "core", { zeroConfig: true, label: "GitHub público (repos/issues sem token)" }),
  CH("rss", "core", { zeroConfig: true, label: "RSS/Atom feeds" }),
  CH("v2ex", "core", { zeroConfig: true, label: "V2EX (leitura pública)" }),
  CH("bilibili", "core", { zeroConfig: true, label: "Bilibili básico (leitura pública)" }),
  // search: pode exigir chave/provedor
  CH("exa-search", "search", { label: "Busca (Exa/mcporter)", requires: ["api-key-opcional"], riskNotes: ["provedor externo; sem chave cai em modo limitado"] }),
  // social: cookie/login — consentimento explícito POR canal
  CH("twitter", "social", { label: "Twitter/X", requires: ["cookie/login"], riskNotes: ["use conta secundária", "cookie nunca no repo/projeto", "sessão pode ser derrubada pelo provedor"] }),
  CH("reddit", "social", { label: "Reddit", requires: ["cookie/login"], riskNotes: ["use conta secundária", "cookie nunca no repo/projeto"] }),
  CH("facebook", "social", { label: "Facebook", requires: ["cookie/login"], riskNotes: ["use conta secundária", "cookie nunca no repo/projeto"] }),
  CH("instagram", "social", { label: "Instagram", requires: ["cookie/login"], riskNotes: ["use conta secundária", "cookie nunca no repo/projeto"] }),
  CH("xiaohongshu", "social", { label: "Xiaohongshu", requires: ["cookie/login"], riskNotes: ["use conta secundária", "cookie nunca no repo/projeto"] }),
  // professional: login/chave/dados
  CH("linkedin", "professional", { label: "LinkedIn", requires: ["cookie/login"], riskNotes: ["ToS restritivo — risco de bloqueio de conta"] }),
  CH("xueqiu", "professional", { label: "Xueqiu (dados financeiros)", requires: ["cookie/login"], riskNotes: ["dados sensíveis de conta"] }),
  CH("podcasts", "professional", { label: "Podcasts/transcrição", requires: ["api-key-opcional"], riskNotes: ["transcrição pode usar serviço externo"] }),
])

export function getChannel(id) {
  return CHANNELS.find((c) => c.id === id) || null
}

export function channelsByGroup(group) {
  return CHANNELS.filter((c) => c.group === group)
}

/** Canais do DEFAULT seguro: só zero-config do grupo core. */
export function coreChannels() {
  return CHANNELS.filter((c) => c.group === "core" && c.zeroConfig)
}

/** Canal sensível = exige cookie/login (consentimento explícito por canal). */
export function isSensitive(channel) {
  return (channel.requires || []).some((r) => /cookie|login/i.test(r))
}

/** Resolve ids/grupos/all → lista de canais; ids desconhecidos vão em `unknown`. */
export function resolveSelection(tokens = []) {
  const picked = new Map()
  const unknown = []
  for (const t of tokens) {
    if (t === "all") { CHANNELS.forEach((c) => picked.set(c.id, c)); continue }
    if (GROUPS.includes(t)) { channelsByGroup(t).forEach((c) => picked.set(c.id, c)); continue }
    const ch = getChannel(t)
    if (ch) picked.set(ch.id, ch)
    else unknown.push(t)
  }
  return { channels: [...picked.values()], unknown }
}
