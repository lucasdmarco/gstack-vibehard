// @ts-check
import { layerOf } from "./command-layers.js"

/**
 * Registry de efeitos por operação (PRD51 S51.4.5, schema mínimo do §51.4).
 *
 * Escopo HONESTO: cobre as operações que esta sessão investigou e corrigiu de
 * verdade (S51.4.1-S51.4.3 — `plan run`, `visual hooks install`, `research
 * skills audit --repo`) mais um punhado de operações bem conhecidas do
 * caminho principal. NÃO afirma cobertura completa dos ~49 comandos do
 * DISPATCH — catalogar efeito real de cada subcomando exigiria auditar cada
 * um individualmente (como foi feito aqui pelos 3 primeiros), não inventar a
 * partir do nome. `OPERATION_EFFECTS` é o vocabulário fechado; entradas fora
 * dele são erro de dado, não just documentação solta.
 *
 * PRD52 S52.H (ADR-006) — os quatro campos que o §14 pedia num registry NOVO
 * entram aqui, porque a comparação formal mostrou que se trata da mesma
 * entidade: `handler`, `alias`, `help` e `flags`. São OPCIONAIS e a ausência não
 * é inferida — um comando sem `handler` declarado não vira "handler pelo nome".
 * Cada um é verificado contra a CLI real por `operation-registry-fields.js`.
 */
export const OPERATION_REGISTRY_SCHEMA = "gstack.operation-registry.v1"

export const OPERATION_EFFECTS = Object.freeze([
  "read", "write_project_state", "write_project_config",
  "network", "execute", "secret_access", "global_write",
])

export const OPERATION_REGISTRY = Object.freeze([
  {
    command: "plan", subcommand: "run",
    effects: ["write_project_state", "execute"],
    network: false, execution: true, requiresConsent: true, jsonSchema: null,
    handler: "plan", help: "plan", flags: ["--json", "--dry-run", "--recipe", "--yes"],
  },
  {
    command: "visual", subcommand: "hooks install",
    effects: ["write_project_config"],
    network: false, execution: true, requiresConsent: true, jsonSchema: "gstack.design-hook-projection.v1",
    handler: "visual", help: "visual", flags: ["--json", "--yes"],
  },
  {
    command: "visual", subcommand: "hooks status",
    effects: ["read"],
    network: false, execution: false, requiresConsent: false, jsonSchema: null,
    handler: "visual", help: "visual", flags: ["--json"],
  },
  {
    command: "research", subcommand: "skills audit --repo",
    effects: ["network"],
    network: true, execution: false, requiresConsent: true, jsonSchema: "gstack.external-skills-audit.v1",
    handler: "research", help: "research", flags: ["--repo", "--yes", "--json"],
  },
  {
    command: "research", subcommand: "skills audit --path",
    effects: ["read"],
    network: false, execution: false, requiresConsent: false, jsonSchema: "gstack.external-skills-audit.v1",
    handler: "research", help: "research", flags: ["--path", "--json"],
  },
  {
    command: "start", subcommand: null,
    effects: ["write_project_state", "write_project_config", "execute"],
    network: false, execution: true, requiresConsent: true, jsonSchema: null,
    handler: "start", help: "start", flags: ["--skills", "--assume-no-existing-model", "--yes", "--dry-run", "--json"],
  },
  {
    command: "verify", subcommand: null,
    effects: ["execute"],
    network: false, execution: true, requiresConsent: false, jsonSchema: null,
    handler: "verify", help: "verify",
    // AUDITADO no fonte: `verify` LÊ nove flags e o help documenta quatro. As
    // cinco restantes saem declaradas de propósito -- é assim que a lacuna vira
    // visível em vez de continuar sendo conhecimento de quem leu o codigo.
    flags: ["--quick", "--profile", "--agentshield", "--json",
      "--changed-files", "--dry-run", "--harness", "--release", "--tier"],
  },
  {
    command: "prd", subcommand: "status",
    effects: ["read"],
    network: false, execution: false, requiresConsent: false, jsonSchema: "gstack.prd-status-report.v1",
    handler: "prd", help: "prd", flags: ["--json"],
  },
])

/** Toda entrada usa só efeitos do vocabulário fechado — erro de dado, não estilo. */
export function invalidEffects(registry = OPERATION_REGISTRY) {
  const known = new Set(OPERATION_EFFECTS)
  return registry.filter((e) => e.effects.some((f) => !known.has(f)))
    .map((e) => ({ command: e.command, subcommand: e.subcommand, bad: e.effects.filter((f) => !known.has(f)) }))
}

const MUTATING_EFFECTS = new Set(["write_project_state", "write_project_config", "execute", "secret_access", "global_write"])
const isMutating = (entry) => entry.effects.some((f) => MUTATING_EFFECTS.has(f))

/**
 * Ação #8 do PRD51 (§S51.4): "operação mutável classificada read-only" —
 * cruza o registry REAL de efeitos com o firewall Knowledge/Execution
 * (`command-layers.js`, PRD22 §4.3). Uma operação com efeito mutável cujo
 * comando de topo está classificado `knowledge` é uma contradição real —
 * `research`/`visual` são knowledge (nunca editam código-fonte do usuário),
 * mas subcomandos específicos escrevem em `.gstack`/config do projeto: essas
 * escritas são reportadas honestamente (não são "edição de fonte"), então a
 * checagem é sobre o comando de TOPO nunca reivindicar `network`/`execute`/
 * `secret_access`/`global_write` sem que o firewall admita.
 */
export function mutableOperationMisclassified(registry = OPERATION_REGISTRY, layerFn = layerOf) {
  return registry
    .filter((e) => isMutating(e) && layerFn(e.command) === "unknown")
    .map((e) => ({ command: e.command, subcommand: e.subcommand, effects: e.effects, reason: "efeito mutável sem classificação no firewall (nem knowledge nem execution)" }))
}
