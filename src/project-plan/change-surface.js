/**
 * Change Surface (PRD42 S42.7). Classifica QUAL superfície do sistema um diff toca (por caminho),
 * complementando o `classifyDiff` do Action Kernel (que classifica por tipo de arquivo). A
 * superfície decide se a mudança GATEIA release (migrations/runtime/backend/cli/frontend) ou é
 * de baixo risco (docs/config/tests). PURO/testável.
 */
export const CHANGE_SURFACE_SCHEMA = "gstack.change-surface.v1"

const SURFACE_RULES = [
  [/(^|[\\/])migrations?[\\/]/i, "migrations"],
  [/(^|[\\/])src[\\/]runtime[\\/]/i, "runtime"],
  [/(^|[\\/])src[\\/]skills[\\/]/i, "skills"],
  [/(^|[\\/])src[\\/](cli|commands)[\\/]/i, "cli"],
  [/\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i, "frontend"],
  [/(^|[\\/])tests?[\\/]/i, "tests"],
  [/\.md$/i, "docs"],
  [/\.(json|jsonc|ya?ml|toml)$/i, "config"],
  [/(^|[\\/])src[\\/]/i, "backend"],
]

// Ordem de prioridade do primário + superfícies que GATEIAM release.
const SURFACE_ORDER = ["migrations", "runtime", "backend", "cli", "frontend", "skills", "tests", "config", "docs", "other"]
const BLOCKING_SURFACES = new Set(["migrations", "runtime", "backend", "cli", "frontend"])

/** Superfície de UM caminho (primeira regra que casa; fallback 'other'). */
export function surfaceOf(path) {
  const hit = SURFACE_RULES.find(([re]) => re.test(String(path || "")))
  return hit ? hit[1] : "other"
}

/** Classifica o diff em superfícies + se alguma delas gateia release. */
export function classifySurface(files = []) {
  const surfaces = [...new Set(files.map(surfaceOf))]
  const primary = SURFACE_ORDER.find((s) => surfaces.includes(s)) || surfaces[0] || "none"
  return {
    schema: CHANGE_SURFACE_SCHEMA,
    surfaces,
    primary,
    blocking: surfaces.some((s) => BLOCKING_SURFACES.has(s)),
    files: [...files],
  }
}
