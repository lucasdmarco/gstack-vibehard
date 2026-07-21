import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { readRun, lastHashForRun, recordAction } from "../vfa/provenance.js"
import { scanContent, evaluateScan } from "../agents/scanner.js"
import { stripBom } from "../util/json.js"
import { classifyDedupe } from "./dedupe.js"
import { detectConflict } from "./conflicts.js"
import { evaluatePromotion, promoteCandidate } from "./promotion-gate.js"
import { sha256, versionedBackup } from "../installer/safe-write.js"

/**
 * Continuous Learning SEGURO (PRD14 §4.5): o dream aprende de runs REAIS mas
 * NUNCA se auto-promove. Fluxo: learn/propose-skill (deterministico, do
 * provenance) → proposta ISOLADA em .gstack/dream/proposals → promote SÓ com
 * --reviewed + AgentShield builtin limpo → staging em .gstack/dream/promoted.
 *
 * Regras invioláveis:
 *  - toda proposta carrega provenance (runId + hash da cadeia);
 *  - nenhuma promoção sem review humano explícito;
 *  - AgentShield roda ANTES de promover (CRITICO bloqueia);
 *  - auto-learning NUNCA escreve em core/, knowledge/ ou agents/agents/ —
 *    o destino é staging; mover para o corpus é decisão humana + agents build.
 */

// PRD46 S46.3: fato curto (classification "memory") nunca disputa merge com uma
// skill — cada memória é independente, project-scoped e tentative, a menos que a
// assinatura seja IDÊNTICA a algo já visto (aí é update, não nova entrada).
function memoryRouting(candidate, existing) {
  const exact = existing.find((o) => o.dedupe?.signature && o.dedupe.signature === candidate.dedupe?.signature)
  return exact ? { decision: "update", matchId: exact.id, reason: null } : { decision: "new", matchId: null, reason: null }
}

/**
 * Combina conflito (policy/core, precedência mais alta — §6.2) + dedupe (peer-level,
 * S46.3) para decidir o destino de um candidate NOVO (schema do S46.1). Conflito
 * sempre vence: nunca mescla contra camada superior, mesmo que o texto seja parecido.
 * @returns {{decision: "new"|"update"|"merge"|"conflict", matchId: string|null, reason: string|null}}
 */
export function resolveCandidateRouting({ candidate, existingCandidates = [], protectedNames } = {}) {
  const conflict = detectConflict({ candidate, protectedNames })
  if (conflict.conflict) return { decision: "conflict", matchId: null, reason: conflict.reason }
  if (candidate.classification === "memory") return memoryRouting(candidate, existingCandidates)
  const d = classifyDedupe({ candidate, existing: existingCandidates })
  return { decision: d.decision, matchId: d.matchId, reason: null }
}

export function proposalsDir(cwd) { return join(cwd, ".gstack", "dream", "proposals") }
export function promotedDir(cwd) { return join(cwd, ".gstack", "dream", "promoted") }

export function listProposals(cwd) {
  const dir = proposalsDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => loadProposal(cwd, f.replace(/\.json$/, ""))).filter(Boolean)
}

export function loadProposal(cwd, id) {
  const file = join(proposalsDir(cwd), `${id}.json`)
  if (!existsSync(file)) return null
  try { return JSON.parse(stripBom(readFileSync(file, "utf-8"))) } catch { return null }
}

function saveProposal(cwd, proposal) {
  mkdirSync(proposalsDir(cwd), { recursive: true })
  writeFileSync(join(proposalsDir(cwd), `${proposal.id}.json`), JSON.stringify(proposal, null, 2) + "\n")
  return proposal
}

/** Lição DETERMINÍSTICA extraída dos recibos do run (sem LLM, sem invenção). */
export function buildLessonFromRun(receipts, runId) {
  const denials = receipts.filter((r) => r.policy && r.policy.decision === "deny")
  const intents = [...new Set(receipts.map((r) => r.intent).filter(Boolean))]
  const lines = [
    `# Lição do run ${runId}`,
    "",
    `- recibos analisados: ${receipts.length}`,
    `- intents observados: ${intents.slice(0, 12).join(", ") || "(nenhum)"}`,
    `- negações de policy: ${denials.length}`,
  ]
  for (const d of denials.slice(0, 8)) {
    lines.push(`  - deny em \`${d.intent}\` (regras: ${(d.policy.rules || []).join(", ") || "?"})`)
  }
  lines.push("", denials.length
    ? "Padrão a codificar: as ações negadas acima precisam de evidência/challenge ANTES da execução."
    : "Run limpo — candidato a virar exemplo positivo de fluxo.")
  return { title: `Lição do run ${runId}`, content: lines.join("\n") }
}

/** Draft de SKILL a partir do run (esqueleto honesto — humano completa). */
export function buildSkillDraftFromRun(receipts, runId) {
  const intents = [...new Set(receipts.map((r) => r.intent).filter(Boolean))]
  const content = [
    "---",
    `name: skill-proposta-${runId}`,
    `description: "DRAFT gerado do run ${runId} — revisar antes de promover"`,
    "---",
    "",
    `# Skill proposta (run ${runId})`,
    "",
    "## Contexto observado",
    ...intents.slice(0, 12).map((i) => `- ${i}`),
    "",
    "## Passos (COMPLETE ANTES DE PROMOVER)",
    "1. (humano) descreva o procedimento aprendido",
    "2. (humano) liste os gates que validam o resultado",
  ].join("\n")
  return { title: `Skill draft do run ${runId}`, content }
}

/** Cria uma proposta a partir de um run com provenance obrigatório. */
export function createProposal(cwd, { kind, fromRun }) {
  const receipts = readRun(cwd, fromRun)
  if (receipts.length === 0) return { error: "run_not_found", fromRun }
  const built = kind === "skill" ? buildSkillDraftFromRun(receipts, fromRun) : buildLessonFromRun(receipts, fromRun)
  const proposal = {
    id: `${kind}-${fromRun}-${Date.now().toString(36)}`,
    kind,
    fromRun,
    createdAt: new Date().toISOString(),
    title: built.title,
    content: built.content,
    provenance: { runId: fromRun, chainHash: lastHashForRun(cwd, fromRun), receipts: receipts.length },
    status: "proposed",
  }
  return saveProposal(cwd, proposal)
}

/** Diretórios PROIBIDOS ao auto-learning (o corpus é sagrado). */
export const FORBIDDEN_TARGETS = Object.freeze(["core", "knowledge", join("agents", "agents")])

// PRD46 S46.4: escrita PROJECT-SCOPED do candidate promovido. Reusa os primitivos
// hash/backup do Safe Write (`sha256`/`versionedBackup`, já provados no PRD45) —
// NUNCA o wrapper `safeWriteFile`, que registra no manifest GLOBAL de uninstall.
// "nenhuma escrita global" é estrutural aqui: este caminho nunca toca o manifest.
function projectSafeWrite(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true })
  const backup = existsSync(filePath) ? versionedBackup(filePath) : null
  const buf = Buffer.from(String(content))
  const tmp = `${filePath}.gstack-tmp-${process.pid}`
  writeFileSync(tmp, buf)
  renameSync(tmp, filePath)
  return { backup, hash: sha256(buf) }
}

const stepsMd = (candidate) => (candidate.procedure?.steps || []).map((s) => `- ${s}`).join("\n")
const failureMd = (candidate) => (candidate.failurePattern ? `\n## Failure pattern\n${candidate.failurePattern.summary}\n` : "")
const runIdOf = (candidate) => candidate.source?.runId || "?"

function renderCandidateMarkdown(candidate) {
  const steps = stepsMd(candidate)
  return [
    "---", `name: ${candidate.id}`,
    `description: "Golden path promovido do run ${runIdOf(candidate)}"`, "---", "",
    `# ${candidate.title}`, failureMd(candidate),
    "## Procedure", steps || "(sem passos registrados)", "",
  ].join("\n")
}

/**
 * Promove um candidate (schema S46.1) para staging PROJECT-SCOPED — nunca escreve
 * global. Fail-closed via `evaluatePromotion` (provenance/scanner/atestação de
 * review); só escreve quando o veredito é `promotable`.
 */
export function promoteCandidateStaged(cwd, candidate, { reviewed = false, attestation = null } = {}) {
  const verdict = evaluatePromotion({ candidate, reviewed, attestation, cwd })
  if (!verdict.ok) return { error: verdict.status, reason: verdict.reason, id: candidate.id }
  const promoted = promoteCandidate(candidate)
  const outFile = join(promotedDir(cwd), `${candidate.id}.md`)
  const written = projectSafeWrite(outFile, renderCandidateMarkdown(promoted))
  try {
    recordAction(cwd, {
      runId: candidate.source?.runId, intent: "dream:promote-candidate", target: { kind: "file", pathOrName: outFile },
      policy: { decision: "allow", rules: ["human-reviewed", "agentshield-clean", "provenance-verified"] },
    })
  } catch { /* provenance best-effort */ }
  return { promoted: candidate.id, to: outFile, hash: written.hash, candidate: promoted }
}

/**
 * Promove uma proposta: exige review humano, roda AgentShield (CRITICO bloqueia)
 * e grava SÓ no staging (.gstack/dream/promoted). Registra provenance da decisão.
 */
export function promoteProposal(cwd, id, { reviewed = false } = {}) {
  const p = loadProposal(cwd, id)
  if (!p) return { error: "proposal_not_found", id }
  if (!reviewed) return { error: "needs_review", id, hint: "promoção exige revisão humana: repita com --reviewed" }
  const findings = scanContent(`proposal:${id}`, p.content)
  const shield = evaluateScan(findings, { strict: true })
  if (shield.blocked) {
    p.status = "blocked_shield"
    p.shield = { verdict: shield.verdict, findings: findings.map((f) => ({ id: f.id, severity: f.severity, line: f.line })) }
    saveProposal(cwd, p)
    return { error: "blocked_by_agentshield", id, shield: p.shield }
  }
  mkdirSync(promotedDir(cwd), { recursive: true })
  const outFile = join(promotedDir(cwd), `${id}.md`)
  writeFileSync(outFile, p.content + "\n")
  p.status = "promoted"
  p.promotedAt = new Date().toISOString()
  p.promotedTo = outFile
  p.shield = { verdict: shield.verdict, findings: [] }
  saveProposal(cwd, p)
  try {
    recordAction(cwd, {
      runId: p.fromRun, intent: "dream:promote", target: { kind: "file", pathOrName: outFile },
      policy: { decision: "allow", rules: ["human-reviewed", "agentshield-builtin"] },
    })
  } catch { /* provenance best-effort */ }
  return {
    promoted: id, to: outFile, shield: shield.verdict,
    next: "mova manualmente para core/knowledge se fizer sentido e rode `agents build --check` — auto-learning nunca escreve no corpus",
  }
}

export function rejectProposal(cwd, id) {
  const p = loadProposal(cwd, id)
  if (!p) return { error: "proposal_not_found", id }
  p.status = "rejected"
  p.rejectedAt = new Date().toISOString()
  saveProposal(cwd, p)
  return { rejected: id }
}

/** Resumo para `dream status --json`. */
export function learningSummary(cwd) {
  const all = listProposals(cwd)
  const by = (s) => all.filter((p) => p.status === s).length
  return { proposals: all.length, proposed: by("proposed"), promoted: by("promoted"), rejected: by("rejected"), blocked: by("blocked_shield") }
}
