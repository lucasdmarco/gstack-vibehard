import { buildSkillCatalog } from "./catalog.js"
import { buildGateMatrix } from "./gate-matrix.js"

/**
 * Intent → Skill Route (PRD29 Sprint 29.2 + PRD28 28.10).
 *
 * O usuário leigo não escolhe entre 213 skills: o GStack detecta as capacidades
 * tocadas pela intenção (frontend/dados/secrets/deploy/API/paralelo), seleciona
 * as skills dos gates aplicáveis e DECLARA a rota no run — `skillsUsed` deixa de
 * depender da memória do agente.
 *
 * Nesta sprint a rota é DECLARATIVA (perguntas + registro); o bloqueio pre-write
 * chega no 29.3 (F2-B). PURO/testável.
 */

export const ROUTE_SCHEMA = "gstack.skill-route.v1"

// Detectores por palavra-chave sobre objetivo+template (tabela → cc baixa).
// touchesFrontend default-TRUE para templates de app do create (todo scaffold tem UI).
const CAPABILITY_DETECTORS = Object.freeze([
  ["touchesFrontend", /frontend|dashboard|painel|\bui\b|tela|página|pagina|site|landing|app|componente|react|vite|next/i],
  ["touchesData", /banco|database|dados|supabase|postgres|sql|schema|tabela|auth|login|usuário|usuario|cadastro/i],
  ["touchesSecrets", /secret|senha|token|credencial|\.env|api key|chave/i],
  ["touchesDeploy", /deploy|publicar|produção|producao|vercel|hosting|dominio|domínio/i],
  ["touchesExternalApi", /\bapi\b|webhook|stripe|pagamento|integra|openapi|externo/i],
  ["touchesParallel", /paralel|simultâne|simultane|vários agentes|varios agentes|subtarefas independentes/i],
])

/** Capacidades detectadas do texto (objetivo + template + intent do plano). */
export function detectCapabilities(text) {
  const t = String(text || "")
  const caps = {}
  for (const [cap, re] of CAPABILITY_DETECTORS) caps[cap] = re.test(t)
  return caps
}

// Um gate se aplica quando TODAS as chaves booleanas do appliesWhen são
// capacidades detectadas true (chaves não-booleanas — ex.: workspaceState,
// uiChanged — são condição de RUNTIME, fora do escopo da rota estática).
export function gateApplies(gate, caps) {
  const entries = Object.entries(gate.appliesWhen || {})
  if (entries.length === 0) return false
  return entries.every(([key, val]) => (val === true ? caps[key] === true : true))
    && entries.some(([, val]) => val === true)
}

// modelIntake (PRD28 §6.13): o que o usuário JÁ TEM para guiar a UI.
export const MODEL_INTAKE_SOURCES = Object.freeze([
  "screenshot", "figma", "template_referencia", "planilha_modelo_dados",
  "schema_supabase", "openapi", "brand_guide", "app_existente",
])

export function buildModelIntake({ sources = [], skipped = false, skippedBy = null } = {}) {
  if (skipped) return { status: "explicitly_skipped", hasExistingModel: false, sources: [], skippedBy }
  return { status: "complete", hasExistingModel: sources.length > 0, sources: [...sources], skippedBy: null }
}

function selectSkillsFromGates(gates, catalog) {
  const known = new Set(catalog.skills.map((s) => s.id))
  const selected = new Set()
  for (const g of gates) for (const s of g.skills) if (known.has(s)) selected.add(s)
  return [...selected].sort()
}

/**
 * Monta a rota declarada do run. `selectedSkillsOverride` (flag --skills) tem
 * precedência total — o usuário manda; a rota registra a origem da decisão.
 */
export function buildSkillRoute({
  objective = "", template = "", intent = "",
  catalog, matrix, modelIntake,
  selectedSkillsOverride = null,
  root, // default: raiz do PACOTE (catalog.js) — as skills vêm com o produto, não do cwd
} = {}) {
  const cat = catalog || buildSkillCatalog({ root })
  const m = matrix || buildGateMatrix({ root, catalog: cat })
  const caps = detectCapabilities(`${objective} ${template} ${intent}`)
  const applicable = m.gates.filter((g) => gateApplies(g, caps))
  const blocking = applicable.filter((g) => g.mode === "blocking")
  const advisory = applicable.filter((g) => g.mode === "advisory")
  const selectedSkills = selectedSkillsOverride
    ? [...selectedSkillsOverride]
    : selectSkillsFromGates(applicable, cat)
  return {
    schemaVersion: ROUTE_SCHEMA,
    generatedAt: new Date().toISOString(),
    objective,
    detectedCapabilities: caps,
    selectedSkills,
    selectionSource: selectedSkillsOverride ? "user_flag" : "gate_matrix",
    blockingGates: blocking.map((g) => g.id),
    advisoryGates: advisory.map((g) => g.id),
    requiredQuestions: [...new Set(applicable.flatMap((g) => g.requiredQuestions))],
    modelIntake: modelIntake || { status: "missing", hasExistingModel: null, sources: [], skippedBy: null },
  }
}

/** Parse das flags de rota do start (--skills a,b · --assume-no-existing-model). */
export function parseRouteFlags(args = []) {
  const out = { skills: null, assumeNoExistingModel: args.includes("--assume-no-existing-model") }
  const i = args.indexOf("--skills")
  if (i >= 0 && args[i + 1]) out.skills = args[i + 1].split(",").map((s) => s.trim()).filter(Boolean)
  return out
}
