/**
 * Knowledge/Execution firewall (PRD22 §4.3, consolidado no PRD23 Fase3).
 *
 * Invariante do produto — NÃO é um gate em runtime, é uma CLASSIFICAÇÃO
 * máquina-legível dos comandos do GStack usada por docs, testes e revisão:
 *
 *  - KNOWLEDGE: consulta/análise READ-ONLY. NUNCA edita código-fonte, nunca
 *    passa por worktree/gate. Ex.: `context`, `consult`, `challenge`, `plan`.
 *  - EXECUTION: controle/mutação GATED. Só age via worktree, gates, provenance
 *    e rollback. Ex.: `task`, `workflow`, `delegate`, `dev`, `verify`, `publish-guard`.
 *  - NEUTRAL: meta/ajuda que não edita código do usuário (ex.: `help`).
 *
 * Os três conjuntos são DISJUNTOS: nenhum comando pertence a mais de uma camada.
 * `layerOf` é a fonte única para afirmar "esse comando é read-only?".
 */

// Explícitos do PRD22 §4.3 + comandos de diagnóstico/leitura que não tocam código.
export const KNOWLEDGE = Object.freeze([
  "context", "consult", "challenge", "plan", // PRD22 §4.3 (read-only)
  "audit", "qa", "doctor", "status", "list", "monitor", "logs", "state", // diagnóstico/leitura
  "skills", // PRD29: inventário/diagnóstico de skills — nunca edita fonte (artefatos .gstack como o context)
  "research", // PRD29 29.5: auditoria READ-ONLY de skills externas — nunca executa/instala/edita fonte
])

// Explícitos do PRD22 §4.3 + tudo que muta repo/config/estado (via gates).
export const EXECUTION = Object.freeze([
  "task", "workflow", "delegate", "dev", "verify", "publish-guard", "proof", // proof roda os gates (spawna suítes), como verify
  "start", "orchestrate", "sprint", "runtime", "stop", "open", // execução/runtime
  "install", "create", "init", "uninstall", "enable", "disable", // instalação/ativação
  "secrets", "agents", "policy", "worktree", "update", "dream", "proxy", // infra que escreve
  "tools", "pp", "a2a", // tools (refresh escreve), pp=alias tools, a2a dispara agentes
])

// Meta/ajuda: não é knowledge (não consulta a base) nem execution (não muta nada).
export const NEUTRAL = Object.freeze(["help"])

const INDEX = new Map()
for (const c of KNOWLEDGE) INDEX.set(c, "knowledge")
for (const c of EXECUTION) INDEX.set(c, "execution")
for (const c of NEUTRAL) INDEX.set(c, "neutral")

/** Camada de um comando: "knowledge" | "execution" | "neutral" | "unknown". */
export function layerOf(command) {
  return INDEX.get(command) || "unknown"
}

/** True só quando o comando é READ-ONLY (camada knowledge). */
export function isReadOnly(command) {
  return layerOf(command) === "knowledge"
}

/** Snapshot das três camadas (para render/testes). */
export function layers() {
  return { knowledge: [...KNOWLEDGE], execution: [...EXECUTION], neutral: [...NEUTRAL] }
}
