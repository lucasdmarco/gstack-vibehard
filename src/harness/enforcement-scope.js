// @ts-check
import { existsSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { ADAPTER_MATRIX } from "../agents/adapter-matrix.js"

/**
 * PRD51 S51.7.8 — classificação clara de enforcement POR HARNESS (§51.7).
 *
 * Achado que motivou o módulo: duas afirmações do próprio repo pareciam se
 * contradizer, e as duas são VERDADEIRAS —
 *   - `design-hooks.js`: "Codex e OpenCode não têm API de hook project-local"
 *   - `codex.js`: escreve hooks REAIS em `~/.codex/config.toml`
 * A `ADAPTER_MATRIX` declarava o NÍVEL de enforcement (`real_hooks`,
 * `partial`, …) mas não tinha nenhum eixo pra ONDE esse enforcement mora.
 * Sem esse eixo, "tem hook real" e "não tem hook project-local" leem como
 * conflito quando na verdade são respostas a perguntas diferentes.
 *
 * Este módulo é o eixo que faltava. Ele NÃO substitui a matriz — é ortogonal
 * a ela, e um teste amarra os dois para que não possam divergir.
 */
export const ENFORCEMENT_SCOPE_SCHEMA = "gstack.enforcement-scope.v1"

export const ENFORCEMENT_SCOPES = Object.freeze([
  "global_only",         // o que bloqueia mora só em ~/ (config do usuário, vale pra TODOS os projetos)
  "project_local_only",  // o que bloqueia mora só dentro do projeto
  "both",                // superfície global E project-local, cada uma com papel próprio
  "none",                // nada bloqueia em lugar nenhum (instrucional/detecção)
])

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(__dirname, "..")

/**
 * `writer` aponta o módulo que REALMENTE escreve a superfície, e `evidence` um
 * fragmento literal que tem que existir nele — é isso que impede a declaração
 * de virar prosa desatualizada quando o código muda.
 */
const surface = (path, writer, evidence) => Object.freeze({ path, writer, evidence })

export const ENFORCEMENT_SCOPE = Object.freeze({
  claude: {
    scope: "both",
    global: [surface("~/.claude/settings.json", "harness/claude.js", 'join(HOME, ".claude")')],
    projectLocal: [surface(".claude/settings.json", "harness/design-hooks.js", '".claude", "settings.json"')],
    blockingSurface: "global",
    note: "o hook que BLOQUEIA é o global do install; a projeção project-local do design é PostToolUse advisory (nunca bloqueia)",
  },
  codex: {
    scope: "global_only",
    global: [surface("~/.codex/config.toml", "harness/codex.js", '".codex", "config.toml"')],
    projectLocal: [],
    blockingSurface: "global",
    note: "hook real existe, mas SÓ global — o Codex não expõe API de hook project-local; no projeto ele recebe apenas o bloco instrucional de AGENTS.md, que não é enforcement",
  },
  cursor: {
    scope: "both",
    global: [surface("~/.cursor/hooks.json", "harness/cursor.js", '"hooks.json"')],
    projectLocal: [surface(".cursor/rules/*.mdc", "harness/design-hooks.js", '".cursor", "rules"')],
    blockingSurface: "global",
    note: "só o hooks.json global bloqueia; as regras .mdc project-local são rules_only (carregadas pelo editor, jamais bloqueiam)",
  },
  opencode: {
    scope: "global_only",
    global: [surface("~/.config/opencode/plugins/", "harness/opencode.js", '"plugins"')],
    projectLocal: [],
    blockingSurface: "global",
    note: "plugins auto-carregam do diretório global; a config do usuário (opencode.json/.jsonc) é sagrada e NUNCA é reescrita",
  },
  copilot: {
    scope: "none",
    global: [],
    projectLocal: [surface(".github/copilot-instructions.md", "harness/design-hooks.js", '".github", "copilot-instructions.md"')],
    blockingSurface: null,
    note: "arquivo project-local existe, mas é instrucional puro — o agente pode ignorar; não é enforcement em escopo nenhum",
  },
  gemini: { scope: "none", global: [], projectLocal: [], blockingSurface: null, note: "instrucional (GEMINI.md) — nada bloqueia" },
  windsurf: { scope: "none", global: [], projectLocal: [], blockingSurface: null, note: "orientação por repo — nada bloqueia" },
  kiro: { scope: "none", global: [], projectLocal: [], blockingSurface: null, note: "apenas detectado — nenhum artefato gerado" },
  hermes: {
    scope: "global_only",
    global: [surface("~/.hermes/skills", "harness/hermes.js", "hermes")],
    projectLocal: [],
    blockingSurface: null,
    note: "enforcement parcial via MCP, sem pre-tool hook — a superfície é global, mas não há bloqueio pré-ação garantido",
  },
  devin: {
    scope: "project_local_only",
    global: [],
    projectLocal: [surface(".devin/hooks.v1.json", "harness/devin.js", ".devin")],
    blockingSurface: "projectLocal",
    note: "único harness cujo hook real é project-local (install --project-only); cloud handoff é opt-in explícito, nunca default",
  },
})

const allSurfaces = (row) => [...(row.global || []), ...(row.projectLocal || [])]

/**
 * Confere cada superfície declarada contra o módulo que diz escrevê-la.
 * `missingWriter` = o arquivo sumiu; `missingEvidence` = o arquivo existe mas
 * não contém mais o fragmento declarado (a declaração ficou stale).
 */
export function scopeDrift(srcRoot = SRC_ROOT) {
  const drift = []
  for (const [harness, row] of Object.entries(ENFORCEMENT_SCOPE)) {
    for (const s of allSurfaces(row)) {
      const abs = join(srcRoot, s.writer)
      if (!existsSync(abs)) { drift.push({ harness, surface: s.path, problem: "missingWriter", writer: s.writer }); continue }
      if (!readFileSync(abs, "utf-8").includes(s.evidence)) drift.push({ harness, surface: s.path, problem: "missingEvidence", writer: s.writer, evidence: s.evidence })
    }
  }
  return drift
}

/** Harnesses declarados na matriz mas sem escopo (ou vice-versa) — não podem divergir. */
export function scopeMatrixGaps() {
  const matrix = Object.keys(ADAPTER_MATRIX)
  const scoped = Object.keys(ENFORCEMENT_SCOPE)
  return {
    matrixWithoutScope: matrix.filter((h) => !scoped.includes(h)),
    scopeWithoutMatrix: scoped.filter((h) => !matrix.includes(h)),
  }
}

/**
 * A reconciliação explícita, como DADO e não como comentário: as duas frases
 * do repo são verdadeiras porque respondem a perguntas diferentes.
 */
export const PROJECT_LOCAL_HOOK_API = Object.freeze({
  claude: true, cursor: true, devin: true,
  codex: false, opencode: false, copilot: false, gemini: false, windsurf: false, kiro: false, hermes: false,
})

export function enforcementScopeReport() {
  const harnesses = Object.entries(ENFORCEMENT_SCOPE).map(([harness, row]) => ({
    harness,
    enforcement: ADAPTER_MATRIX[harness]?.enforcement || "detection_only",
    scope: row.scope,
    blockingSurface: row.blockingSurface,
    projectLocalHookApi: PROJECT_LOCAL_HOOK_API[harness] === true,
    global: (row.global || []).map((s) => s.path),
    projectLocal: (row.projectLocal || []).map((s) => s.path),
    note: row.note,
  }))
  const drift = scopeDrift()
  const gaps = scopeMatrixGaps()
  return {
    schemaVersion: ENFORCEMENT_SCOPE_SCHEMA,
    harnesses,
    drift,
    gaps,
    ok: drift.length === 0 && gaps.matrixWithoutScope.length === 0 && gaps.scopeWithoutMatrix.length === 0,
  }
}
