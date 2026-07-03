import { getAdapterInfo } from "../agents/adapter-matrix.js"
import { normalizePolicy } from "./schema.js"

/**
 * Compilador da Policy DSL para cada harness (PRD15 §7.1). A MESMA policy vira
 * artefatos por harness, mas o nível de aplicação é HONESTO: só `real_hooks`
 * bloqueia de verdade; o resto é `advisory`/`rules_only`/`instructional`. Nenhum
 * harness instrucional pode ser anunciado como Zero-Trust.
 */

// enforcement do adapter → nível honesto de aplicação da policy.
const LEVEL_BY_ENFORCEMENT = Object.freeze({
  real_hooks: "enforced",
  partial: "partial",
  rules_only: "advisory",
  instructional: "advisory",
  detection_only: "advisory",
})

export function enforcementLevel(harnessId) {
  return LEVEL_BY_ENFORCEMENT[getAdapterInfo(harnessId).enforcement] || "advisory"
}

/** Artefato de permissões no formato Devin-like (allow/deny/ask). */
function permissionsArtifact(policy) {
  const p = normalizePolicy(policy).permissions
  return { permissions: { allow: p.allow, deny: p.deny, ask: p.ask } }
}

/** Bloco de regras legível (para harnesses instrucionais/rules_only). */
function rulesMarkdown(policy) {
  const p = normalizePolicy(policy).permissions
  const line = (title, arr) => `- ${title}: ${arr.length ? arr.join(", ") : "(nenhum)"}`
  return [
    "# GStack policy (compilada — ADVISORY neste harness)",
    "Ordem: deny > ask > allow > default.",
    line("DENY (nunca)", p.deny),
    line("ASK (confirmar)", p.ask),
    line("ALLOW (liberado)", p.allow),
  ].join("\n")
}

/**
 * Compila a policy para um harness. Retorna nível honesto + artefato adequado.
 * @returns {{ harness, enforcement, level, artifactKind, artifact, advisory }}
 */
export function compilePolicy(policy, harnessId) {
  const info = getAdapterInfo(harnessId)
  const level = enforcementLevel(harnessId)
  const usesPermissions = info.enforcement === "real_hooks" || info.enforcement === "partial"
  return {
    harness: harnessId,
    enforcement: info.enforcement,
    level, // "enforced" | "partial" | "advisory"
    advisory: level !== "enforced",
    artifactKind: usesPermissions ? "permissions" : "rules_markdown",
    artifact: usesPermissions ? permissionsArtifact(policy) : rulesMarkdown(policy),
    target: info.target,
  }
}

/** Compila para vários harnesses (default: todos os conhecidos exceto unknown). */
export function compileAll(policy, harnessIds) {
  return (harnessIds || []).map((h) => compilePolicy(policy, h))
}
