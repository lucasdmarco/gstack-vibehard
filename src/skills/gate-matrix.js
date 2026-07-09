import { buildSkillCatalog } from "./catalog.js"

/**
 * Skill Gate Compiler (PRD29 Sprint 29.1).
 *
 * A skill ACONSELHA; o gate DECIDE se o fluxo avança. Este módulo compila a
 * matriz de gates por fase a partir de um mapa MANUAL dos P0/P1 (classificador
 * automático apenas sugere — PRD29 §14: matriz inicial manual para gates
 * críticos) e VALIDA contra o catálogo real (29.0): skill citada que não existe
 * vira warning; precondições contraditórias entre gates da mesma fase reprovam
 * a compilação.
 *
 * Precondição = string `caminho in valorA|valorB` (machine-checkable). Conflito
 * = dois gates aplicáveis na MESMA fase exigem o MESMO caminho com conjuntos
 * DISJUNTOS de valores — impossível satisfazer os dois.
 */

export const GATE_MATRIX_SCHEMA = "gstack.skill-gate-matrix.v1"

// ── Mapa manual dos gates P0/P1 (fonte de verdade desta sprint) ──────────────────
// mode: blocking = impede avanço; advisory = registra e explica, não trava.
// verifier: SEMPRE determinístico (json-schema/file-exists/command) — LLM nunca decide.
export const SKILL_GATES = Object.freeze([
  {
    id: "cwd-health-gate", phase: "intake-onboarding", severity: "P0", mode: "blocking",
    skills: ["start", "package-management"],
    appliesWhen: { workspaceState: ["home_or_wrong_cwd", "empty_git_repo"] },
    preconditions: ["workspace.state in gstack_project|node_app|empty_dir"],
    requiredQuestions: ["Criar novo projeto, entrar em um existente ou diagnosticar?"],
    requiredEvidence: [],
    verifier: "workspace-classifier", fallback: "ask_before_any_write",
    implementedBy: "src/runtime/workspace.js (v3.80.0)",
  },
  {
    id: "plan-before-code-gate", phase: "planning-spec", severity: "P0", mode: "blocking",
    skills: ["project-lifecycle", "guided-delivery", "writing-plans"],
    appliesWhen: { writesCode: true },
    preconditions: ["plan.status in approved|explicit_yes"],
    requiredQuestions: ["Executar este plano?"],
    requiredEvidence: [".gstack/plans/<planId>/plan.json"],
    verifier: "file-exists", fallback: "block_before_write",
    implementedBy: "src/commands/start.js confirmExecution",
  },
  {
    id: "existing-model-intake-gate", phase: "design-ui", severity: "P0", mode: "blocking",
    skills: ["frontend-design", "mockup-extract", "recreate-screenshot"],
    appliesWhen: { touchesFrontend: true },
    preconditions: ["modelIntake.status in complete|explicitly_skipped"],
    requiredQuestions: ["Você já tem screenshot/Figma/template/schema/brand para eu seguir?"],
    requiredEvidence: [".gstack/runs/<runId>/skill-route.json"],
    verifier: "json-schema", fallback: "block_before_write",
  },
  {
    id: "design-system-gate", phase: "design-ui", severity: "P0", mode: "blocking",
    skills: ["frontend-design", "react-vite", "design"],
    appliesWhen: { touchesFrontend: true },
    preconditions: ["modelIntake.status in complete|explicitly_skipped", "designSystemGate.status in complete|generated"],
    requiredQuestions: ["Você já tem um design system próprio?"],
    requiredEvidence: [".gstack/design-system.json", ".gstack/runs/<runId>/design-system-gate.json"],
    verifier: "json-schema + file-exists", fallback: "block_before_write",
  },
  {
    id: "visual-validation-gate", phase: "test-preview", severity: "P1", mode: "blocking",
    skills: ["dev-preview", "auto-testing", "testing"],
    appliesWhen: { uiChanged: true },
    preconditions: ["visualEvidence.status in captured|not_applicable"],
    requiredQuestions: [],
    requiredEvidence: [".gstack/runs/<runId>/skill-evidence.json"],
    verifier: "file-exists", fallback: "block_before_ship",
  },
  {
    id: "secret-deny-gate", phase: "security", severity: "P0", mode: "blocking",
    skills: ["environment-secrets", "security_scan"],
    appliesWhen: { touchesSecrets: true },
    preconditions: ["secrets.envTracked in false", "secrets.envRead in false"],
    requiredQuestions: [],
    requiredEvidence: [],
    verifier: "command (git ls-files .env*)", fallback: "block_always",
    implementedBy: "delegação bloqueia .env rastreado (v3.4x)",
  },
  {
    id: "db-migration-gate", phase: "data-auth-api", severity: "P1", mode: "blocking",
    skills: ["database", "supabase-postgres-best-practices"],
    appliesWhen: { schemaChanged: true },
    preconditions: ["db.migrationPresent in true"],
    requiredQuestions: [],
    requiredEvidence: ["migrations/"],
    verifier: "file-exists", fallback: "block_before_ship",
  },
  {
    id: "rls-gate", phase: "data-auth-api", severity: "P1", mode: "blocking",
    skills: ["database"],
    appliesWhen: { touchesData: true, sensitiveTables: true },
    preconditions: ["db.rlsDeclared in true|not_applicable"],
    requiredQuestions: ["Há tabela sensível sem RLS/policy?"],
    requiredEvidence: [],
    verifier: "json-schema", fallback: "block_before_ship",
  },
  {
    id: "worktree-required-gate", phase: "delegation-parallel", severity: "P0", mode: "blocking",
    skills: ["delegation", "using-git-worktrees"],
    appliesWhen: { delegatesExternal: true },
    preconditions: ["delegation.worktree in true"],
    requiredQuestions: [],
    requiredEvidence: [],
    verifier: "command (git worktree list)", fallback: "block_before_delegate",
    implementedBy: "delegate --worktree default (v3.4x)",
  },
  {
    id: "context-pack-required-gate", phase: "delegation-parallel", severity: "P1", mode: "blocking",
    skills: ["delegation", "graphify"],
    appliesWhen: { parallelAgents: true },
    preconditions: ["contextPack.state in fresh"],
    requiredQuestions: ["Posso gerar/atualizar o Context Pack antes de paralelizar?"],
    requiredEvidence: [".gstack/runs/<runId>/context-pack.json"],
    verifier: "file-exists", fallback: "generate_or_block",
  },
  {
    id: "verify-proof-gate", phase: "ship-closeout", severity: "P0", mode: "blocking",
    skills: ["project-lifecycle", "guided-delivery", "split-to-prs"],
    appliesWhen: { ships: true },
    preconditions: ["verify.status in ready", "proof.ready in true"],
    requiredQuestions: [],
    requiredEvidence: [],
    verifier: "command (verify/proof --json)", fallback: "block_before_ship",
    implementedBy: "src/commands/proof.js (v3.78.0)",
  },
  {
    id: "skill-route-gate", phase: "intake-onboarding", severity: "P1", mode: "advisory",
    skills: ["guided-delivery", "find-skills"],
    appliesWhen: { writesCode: true },
    preconditions: ["skillRouting.selectedSkills in nonempty"],
    requiredQuestions: ["Executar esta etapa usando as skills recomendadas?"],
    requiredEvidence: [".gstack/runs/<runId>/skill-route.json"],
    verifier: "json-schema", fallback: "warn_and_log",
    note: "vira blocking quando o wiring do start chegar (F2-A/29.2)",
  },
])

// ── Compilação: valida skills contra o catálogo e detecta conflitos ──────────────
function parsePrecondition(p) {
  const m = String(p).match(/^(\S+)\s+in\s+(.+)$/)
  return m ? { path: m[1], allowed: m[2].split("|").map((s) => s.trim()) } : null
}

function unknownSkillWarnings(gates, knownIds) {
  const warnings = []
  for (const g of gates) {
    const missing = g.skills.filter((s) => !knownIds.has(s))
    if (missing.length) warnings.push({ gate: g.id, kind: "unknown_skill", skills: missing })
  }
  return warnings
}

const disjoint = (a, b) => !a.some((v) => b.includes(v))
// groupBy manual (Map.groupBy é Node 21+; o floor do produto é 18).
function groupByPhase(gates) {
  const map = new Map()
  for (const g of gates) {
    if (!map.has(g.phase)) map.set(g.phase, [])
    map.get(g.phase).push(g)
  }
  return map
}
// Precondições parseadas de um gate (uma linha por path exigido).
function gatePreconditions(g) {
  return g.preconditions.map(parsePrecondition).filter(Boolean).map((p) => ({ ...p, gate: g.id }))
}
// Compara cada precondição com a primeira vista para o mesmo path na fase.
function checkPhaseGroup(phase, group, conflicts) {
  const seen = new Map() // path → {gate, allowed}
  for (const p of group.flatMap(gatePreconditions)) {
    const prev = seen.get(p.path)
    if (prev && disjoint(prev.allowed, p.allowed)) {
      conflicts.push({ phase, path: p.path, gates: [prev.gate, p.gate], allowed: [prev.allowed, p.allowed] })
    }
    if (!prev) seen.set(p.path, { gate: p.gate, allowed: p.allowed })
  }
}
// Conflito: mesmo path exigido com conjuntos DISJUNTOS por 2 gates da mesma fase.
function findConflicts(gates) {
  const conflicts = []
  for (const [phase, group] of groupByPhase(gates)) checkPhaseGroup(phase, group, conflicts)
  return conflicts
}

/**
 * Compila a matriz: gates manuais + validação contra o catálogo real.
 * `ok:false` SOMENTE com conflito de precondição (skill desconhecida = warning).
 */
export function buildGateMatrix({ root, catalog, gates = SKILL_GATES } = {}) {
  const cat = catalog || buildSkillCatalog({ root })
  const knownIds = new Set(cat.skills.map((s) => s.id))
  const warnings = unknownSkillWarnings(gates, knownIds)
  const conflicts = findConflicts(gates)
  return {
    schemaVersion: GATE_MATRIX_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok: conflicts.length === 0,
    totalGates: gates.length,
    blocking: gates.filter((g) => g.mode === "blocking").length,
    advisory: gates.filter((g) => g.mode === "advisory").length,
    catalogTotalSkills: cat.totalSkills,
    warnings, conflicts,
    gates: [...gates],
  }
}

/** Gates de uma fase (aceita alias "frontend" → design-ui). */
const PHASE_ALIASES = Object.freeze({ frontend: "design-ui", ui: "design-ui", db: "data-auth-api", data: "data-auth-api", ship: "ship-closeout" })
export function gatesForPhase(matrix, phase) {
  const canonical = PHASE_ALIASES[phase] || phase
  return matrix.gates.filter((g) => g.phase === canonical)
}

// ── explain (29.8): "por que este gate existe e como satisfazê-lo" ───────────────
export const GATE_EXPLAIN_SCHEMA = "gstack.skill-gate-explain.v1"

// Ação humana por fallback (o que acontece se a precondição falhar).
const FALLBACK_HELP = Object.freeze({
  ask_before_any_write: "pergunta antes de qualquer escrita",
  block_before_write: "bloqueia a escrita até a precondição ser satisfeita",
  block_always: "bloqueia sempre até a evidência existir",
  block_before_ship: "bloqueia o ship (deploy/PR) até passar",
  block_before_delegate: "bloqueia a delegação até a precondição valer",
  generate_or_block: "gera o artefato ausente ou bloqueia",
  warn_and_log: "apenas avisa e registra (advisory)",
})

// Como satisfazer: evidência tem prioridade; senão a pergunta-chave.
function howToSatisfy(gate) {
  if (gate.requiredEvidence.length) return `Gere/garanta: ${gate.requiredEvidence.join(", ")}`
  if (gate.requiredQuestions.length) return `Responda: "${gate.requiredQuestions[0]}"`
  return "Satisfaça as precondições listadas."
}

/** Explicação estruturada de um gate (para `skills why <gate>`). PURO. */
export function explainGate(gate) {
  return {
    schemaVersion: GATE_EXPLAIN_SCHEMA,
    gate: gate.id,
    phase: gate.phase,
    severity: gate.severity,
    mode: gate.mode,
    skills: [...gate.skills],
    appliesWhen: gate.appliesWhen,
    why: `A skill aconselha; o gate '${gate.id}' DECIDE se o fluxo avança. ${gate.mode === "blocking" ? "É blocking: sem satisfazê-lo, a etapa não passa." : "É advisory: registra e explica, não trava."}`,
    preconditions: [...gate.preconditions],
    requiredQuestions: [...gate.requiredQuestions],
    requiredEvidence: [...gate.requiredEvidence],
    verifier: gate.verifier,
    fallback: gate.fallback,
    fallbackMeaning: FALLBACK_HELP[gate.fallback] || gate.fallback,
    howToSatisfy: howToSatisfy(gate),
  }
}

/** Render markdown da matriz (resumo — o JSON é a fonte completa). */
export function renderGateMatrixMarkdown(m) {
  const lines = [
    `# Skill Gate Matrix — ${m.totalGates} gates (${m.blocking} blocking / ${m.advisory} advisory)`, "",
    `Gerado: ${m.generatedAt} · schema ${m.schemaVersion} · conflitos: ${m.conflicts.length}`, "",
    "| Gate | Fase | Sev | Modo | Skills |", "|---|---|---|---|---|",
    ...m.gates.map((g) => `| ${g.id} | ${g.phase} | ${g.severity} | ${g.mode} | ${g.skills.join(", ")} |`),
    "",
    "A skill aconselha; o gate decide. Verifier sempre determinístico — LLM nunca aprova.", "",
  ]
  return lines.join("\n")
}
