import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

/**
 * Skill Reach por harness (PRD36 36.8 — absorve a antiga rec #1 do oh-my-openagent).
 *
 * O produto SHIPA N skills, mas cada harness só "enxerga" as que estão no lugar
 * onde ELE auto-carrega. A doc afirmava que o OpenCode auto-carrega de
 * `~/.config/opencode/skills/*` — mas deixávamos esse diretório VAZIO e nunca
 * verificávamos. Aqui a resposta é POR EVIDÊNCIA: conta quantas skills do catálogo
 * estão REALMENTE presentes nos diretórios que cada harness lê.
 *
 * Dois mecanismos:
 *  - `skills_dir`     o harness auto-carrega SKILL.md de diretórios → reach = quantas
 *                     das N skills do catálogo estão lá (medido, não assumido);
 *  - `instructional`  o harness só vê um PONTEIRO em AGENTS.md/regras — não N skills
 *                     auto-carregadas → reach por-skill é `null` (honesto: não é reach).
 *
 * PURO/testável: io injetável (installedSkillIds).
 */

export const SKILL_REACH_SCHEMA = "gstack.skill-reach.v1"

const HOME = homedir()
const expand = (p) => (p.startsWith("~") ? join(HOME, p.slice(1)) : p)

// Onde cada harness realmente carrega skills (doc oficial verificada). project-scoped
// dirs ficam relativos ao cwd; os globais expandem ~.
export const HARNESS_SKILL_REACH = Object.freeze({
  claude: { mechanism: "skills_dir", dirs: ["~/.claude/skills"] },
  opencode: { mechanism: "skills_dir", dirs: ["~/.config/opencode/skills", "~/.agents/skills"] },
  codex: { mechanism: "instructional", pointer: "~/.codex/AGENTS.md" },
  cursor: { mechanism: "instructional", pointer: ".cursor/rules" },
})

export const REACH_HARNESSES = Object.freeze(Object.keys(HARNESS_SKILL_REACH))

// Lista os IDs de skill (nome do diretório com SKILL.md) presentes num diretório.
function listSkillIdsIn(absDir) {
  try {
    return readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(absDir, e.name, "SKILL.md")))
      .map((e) => e.name)
  } catch { return [] }
}

const defaultIo = Object.freeze({
  installedSkillIds: (dirs) => [...new Set(dirs.flatMap((d) => listSkillIdsIn(expand(d))))],
})

function reachRowSkillsDir(harness, cfg, catalogIds, io) {
  const installed = new Set(io.installedSkillIds(cfg.dirs))
  const reachable = catalogIds.filter((id) => installed.has(id))
  const missing = catalogIds.filter((id) => !installed.has(id))
  return {
    harness, mechanism: "skills_dir", dirs: [...cfg.dirs],
    reachable: reachable.length, declared: catalogIds.length,
    missing,
    proof: `dirs ${cfg.dirs.join(", ")} → ${reachable.length}/${catalogIds.length} skills presentes`,
  }
}

function reachRow(harness, catalogIds, io) {
  const cfg = HARNESS_SKILL_REACH[harness]
  if (!cfg) return { harness, mechanism: "unknown", reachable: null, declared: catalogIds.length }
  if (cfg.mechanism === "instructional") {
    return {
      harness, mechanism: "instructional", pointer: cfg.pointer,
      reachable: null, declared: catalogIds.length,
      proof: `vê um ponteiro em ${cfg.pointer} — NÃO auto-carrega as ${catalogIds.length} skills`,
    }
  }
  return reachRowSkillsDir(harness, cfg, catalogIds, io)
}

/**
 * Reach por harness. `catalog` = saída de buildSkillCatalog (usa os IDs de skill).
 * `ok` = nenhum harness `skills_dir` com reach ZERO (0/N = doc mente, não instalou).
 */
export function buildSkillReach({ catalog, harnesses = REACH_HARNESSES, io = defaultIo } = {}) {
  const catalogIds = [...new Set((catalog?.skills || []).map((s) => s.id))].sort()
  const rows = harnesses.map((h) => reachRow(h, catalogIds, io))
  const zeroReach = rows.filter((r) => r.mechanism === "skills_dir" && r.reachable === 0).map((r) => r.harness)
  return {
    schemaVersion: SKILL_REACH_SCHEMA,
    generatedAt: new Date().toISOString(),
    declared: catalogIds.length,
    rows,
    ok: zeroReach.length === 0,
    zeroReach,
    note: "reach é MEDIDO por evidência (skill presente no diretório do harness); instrucional vê ponteiro, não N skills; 0/N = a doc prometeu auto-load que não existe nesta máquina.",
  }
}

const reachLabel = (r) => (r.mechanism === "instructional" ? "instrucional (ponteiro)" : `${r.reachable}/${r.declared}`)

/** Render markdown do reach por harness. */
export function renderSkillReachMarkdown(report) {
  const lines = [
    `# Skill Reach — ${report.declared} skills no catálogo`, "",
    `Gerado: ${report.generatedAt} · schema ${report.schemaVersion}`, "",
    "| Harness | Mecanismo | Reach | Prova |", "|---|---|---|---|",
  ]
  for (const r of report.rows) lines.push(`| ${r.harness} | ${r.mechanism} | ${reachLabel(r)} | ${r.proof || "—"} |`)
  lines.push("", report.note, "")
  return lines.join("\n")
}
