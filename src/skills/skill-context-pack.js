/**
 * PRD47 S47.3 — Context Pack de fragmentos de skill: materializa APENAS conteúdo
 * `skill|rule_pack|reference_pack` já aprovado pelo Source Lock (PRD46 S46.1/S46.4)
 * em `.gstack/runs/<runId>/context/skills/` — nunca em HOME global, nunca instala,
 * copia ou cria symlink em config de harness. Fail-closed: lock stale/revoked, hash
 * divergente ou path escape nunca materializam.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { hashDrifted } from "./source-lock.js"
import { resolveContainedCwd } from "../runtime/exec-policy.js"

export const SKILL_CONTEXT_PACK_SCHEMA = "gstack.skill-context-pack.v1"
export const FRAGMENT_LIFECYCLE = Object.freeze(["materialized", "consumed", "expired", "purged"])

const APPROVED_LOCK_STATUSES = new Set(["approved", "compiled", "routed", "executed"])

const FRAGMENT_TRANSITIONS = Object.freeze({
  materialized: ["consumed", "expired", "purged"],
  consumed: ["expired", "purged"],
  expired: ["purged"],
  purged: [],
})

/** True se `to` é uma aresta permitida a partir de `from`. */
export function canTransitionFragment(from, to) {
  return (FRAGMENT_TRANSITIONS[from] || []).includes(to)
}

export function fragmentsDir(cwd, runId) {
  return join(cwd, ".gstack", "runs", runId, "context", "skills")
}

/** Um lock só vira fragmento se estiver numa fase aprovada E o hash ainda bater — fail-closed. */
export function validateFragmentEligibility(sourceLock, currentContent = null) {
  if (!sourceLock) return { ok: false, reason: "sem source lock" }
  if (!APPROVED_LOCK_STATUSES.has(sourceLock.status)) return { ok: false, reason: `lock status '${sourceLock.status}' não é aprovado — nunca materializa` }
  if (currentContent != null && hashDrifted(sourceLock, currentContent)) return { ok: false, reason: "hash divergente do lock — stale, nunca materializa" }
  return { ok: true, reason: null }
}

/**
 * Materializa UM fragmento aprovado no run. Fail-closed: elegibilidade + contenção de
 * path (escape via id malformado/symlink) bloqueiam ANTES de qualquer escrita.
 */
export function materializeFragment({ cwd, runId, sourceLock, content = "", currentContent = null } = {}) {
  const eligible = validateFragmentEligibility(sourceLock, currentContent)
  if (!eligible.ok) return { ok: false, reason: eligible.reason, status: null, path: null }
  const dir = fragmentsDir(cwd, runId)
  const contained = resolveContainedCwd(dir, `${sourceLock.id}.md`)
  if (!contained.ok) return { ok: false, reason: contained.reason, status: null, path: null }
  mkdirSync(dir, { recursive: true })
  writeFileSync(contained.path, String(content))
  return { ok: true, reason: null, status: "materialized", path: contained.path, artifactKind: sourceLock.artifactKind }
}

/** Purga um fragmento — remove SÓ o arquivo do próprio run; nunca toca fonte/evidência/artefato alheio. */
export function purgeFragment(cwd, runId, sourceLockId) {
  const p = join(fragmentsDir(cwd, runId), `${sourceLockId}.md`)
  if (existsSync(p)) rmSync(p, { force: true })
  return { status: "purged", path: p }
}
