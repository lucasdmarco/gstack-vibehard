import { existsSync as fsExists } from "fs"
import { join } from "path"
import { sha256 } from "./journal.js"

/**
 * Plano de operações único (PRD41 S41.3 / PRD40 P0.9+P0.10).
 *
 * dry-run e execução consomem o MESMO plano — proibido divergir. O plano é a lista
 * ordenada e determinística de escritas; o dry-run o RENDERIZA (path+hash, sem conteúdo),
 * a execução o roda pelo journal transacional. Assim "o que o dry-run mostra" é, por
 * construção, "o que a instalação faz".
 *
 * P0.10: `.env` NUNCA entra numa lista de exposição — segredo vive no keychain
 * (`gstack_vibehard secrets`), não numa view do Atomic. `assertNoEnvExposure` é a trava.
 */
export const OPERATION_PLAN_SCHEMA = "gstack.operation-plan.v1"

// Views expostas ao Atomic — `.env`/`.env.*` deliberadamente FORA (P0.10).
export const PROJECT_EXPOSE = Object.freeze([
  ".claude/", ".cursor/", ".windsurf/", ".vscode/", ".idea/", ".gstack/", ".mcp.json", ".agent/",
])
export const GLOBAL_DEFAULT_EXPOSE = Object.freeze([".claude/", ".gstack/", ".agent/"])

const ENV_RE = /(^|[/\\])\.env(\.|$|[/\\])/

/** Trava de segurança: rejeita qualquer entrada `.env`/`.env.*` numa lista de exposição. */
export function assertNoEnvExposure(list, where = "expose") {
  const bad = (list || []).filter((p) => p === ".env" || ENV_RE.test(String(p)))
  if (bad.length) {
    throw new Error(`P0.10: '.env' não pode ser exposto em ${where} (${bad.join(", ")})`)
  }
  return list
}

function tomlList(items) {
  return "[\n" + items.map((i) => `  ${JSON.stringify(i)},`).join("\n") + "\n]"
}

function projectWorkspaceToml() {
  assertNoEnvExposure(PROJECT_EXPOSE, "workspace.toml/expose")
  return `[workspace]\nexpose = ${tomlList(PROJECT_EXPOSE)}\n`
}

function globalConfigToml() {
  assertNoEnvExposure(GLOBAL_DEFAULT_EXPOSE, "config.toml/default_expose")
  return `[defaults]\nengine = "atomic"\n\n[workspace]\ndefault_expose = ${tomlList(GLOBAL_DEFAULT_EXPOSE)}\n`
}

/**
 * Constrói o plano das escritas Atomic (project + global). Recebe `io.existsSync` para
 * que o MESMO plano seja calculado no dry-run e na execução dado o estado da máquina —
 * o global só entra se ainda não existir (não clobberar config do usuário).
 */
export function buildAtomicPlan({ projectDir, home }, io = { existsSync: fsExists }) {
  const plan = []
  const projWs = join(projectDir, ".atomic", "workspace.toml")
  const projContent = projectWorkspaceToml()
  plan.push({ scope: "project", kind: "write", path: projWs, content: projContent, hash: sha256(projContent) })

  const globalCfg = join(home, ".atomic", "config.toml")
  if (!io.existsSync(globalCfg)) {
    const gc = globalConfigToml()
    plan.push({ scope: "global", kind: "write", path: globalCfg, content: gc, hash: sha256(gc) })
  }
  return plan
}

/** Renderização do dry-run: path + hash + escopo, SEM conteúdo (o mesmo plano). */
export function renderPlan(plan) {
  return {
    schemaVersion: OPERATION_PLAN_SCHEMA,
    operations: plan.map((op) => ({ scope: op.scope, kind: op.kind, path: op.path, hash: op.hash })),
  }
}

/** Executa o plano pelo journal transacional (falha → rollback automático de tudo). */
export function executePlan(plan, journal) {
  const applied = []
  for (const op of plan) {
    if (op.kind === "write") applied.push(journal.writeFile(op.path, op.content))
    else if (op.kind === "mkdir") applied.push(journal.mkdir(op.path))
    else throw new Error(`operação desconhecida no plano: ${op.kind}`)
  }
  return applied
}
