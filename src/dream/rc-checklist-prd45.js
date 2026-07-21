/**
 * Checklist de Release Candidate do PRD45 (S45.8 — fechamento do programa).
 *
 * Mapeia CADA achado do PRD45 (P0.1–P0.4, P1.1–P1.12) ao sprint e à versão que o fechou, com o
 * artefato de prova (o teste que reprova se a capacidade sumir) e o controle negativo. É a
 * fonte-verdade do "está pronto para RC": `prd45Readiness()` só declara `ready:true` quando
 * todos os P0 estão `delivered`. Sem enfeite — cada `delivered` aponta um teste real; um item
 * que aponta um teste inexistente reprova a própria suíte (rc_checklist_prd45.test.js).
 *
 * Espelha o padrão do rc-checklist.js (PRD41 S41.9): P1 pendente/parcial é AVISO honesto, não
 * bloqueia o RC (P0 é o gate), mas fica registrado como incremento.
 */
export const PRD45_RC_CHECKLIST_SCHEMA = "gstack.rc-checklist.prd45.v1"

// tier: P0 (bloqueador) | P1 (importante). status: delivered | partial | pending.
export const PRD45_RC_ITEMS = Object.freeze([
  { id: "P0.1", tier: "P0", sprint: "S45.0", version: "5.1.0", status: "delivered", title: "MCP Headroom real (fim do pacote fantasma)", proof: "tests/create_full_mcp_real.test.js" },
  { id: "P0.2", tier: "P0", sprint: "S45.1", version: "5.3.0", status: "delivered", title: "stop com estados tipados + state preservado p/ retry", proof: "tests/runtime_stop_ownership.test.js" },
  { id: "P0.3", tier: "P0", sprint: "S45.3", version: "5.5.0", status: "delivered", title: "Workflow fail-closed (worker/planner/rubric falho ≠ passed)", proof: "tests/workflow_fail_closed.test.js" },
  { id: "P0.4", tier: "P0", sprint: "S45.0", version: "5.2.0", status: "delivered", title: "Casdoor seguro: digest/loopback + credencial rotacionada", proof: "tests/create_full_casdoor_rotate.test.js" },
  { id: "P1.1", tier: "P1", sprint: "S45.1", version: "5.3.0", status: "delivered", title: "Ownership de PID fail-closed (unverified_baseline)", proof: "tests/runtime_stop_ownership.test.js" },
  { id: "P1.2", tier: "P1", sprint: "S45.2", version: "5.4.0", status: "delivered", title: "Policy de execução do Runtime Manifest (código inline/cwd escape)", proof: "tests/runtime_exec_policy.test.js" },
  { id: "P1.3", tier: "P1", sprint: "S45.2", version: "5.4.0", status: "partial", title: "Loader V3 canônico — schema/migração existem; loader+create ainda v2 (v3 dormente)", proof: "tests/runtime_manifest.test.js (migrateManifestToV3/validateRuntimeManifestV3)" },
  { id: "P1.4", tier: "P1", sprint: "S45.4", version: "5.6.0", status: "delivered", title: "Headroom routing no dev só após probe de tráfego real", proof: "tests/headroom_route_dev.test.js" },
  { id: "P1.5", tier: "P1", sprint: "S45.3", version: "5.5.0", status: "delivered", title: "Journal com redação recursiva (segredo em campo não literal)", proof: "tests/workflow_journal_redact.test.js" },
  { id: "P1.6", tier: "P1", sprint: "S45.4", version: "5.6.0", status: "delivered", title: "Redact-proxy seguro (loopback/nonce/gzip/rolling-window)", proof: "tests/redact_proxy_hardening.test.js" },
  { id: "P1.7", tier: "P1", sprint: "S45.5", version: "5.7.0", status: "delivered", title: "Install/create transacional (journal write-ahead + rollback)", proof: "tests/provision_txn.test.js" },
  { id: "P1.8", tier: "P1", sprint: "S45.5", version: "5.7.0", status: "delivered", title: "Dry-run fiel (operation plan real: rede/pacote/digest/rollback)", proof: "tests/create_dryrun_fidelity.test.js" },
  { id: "P1.9", tier: "P1", sprint: "S45.6", version: "5.8.0", status: "delivered", title: "Artifact lock (verificação real, nunca `hashes: ok` cego)", proof: "tests/artifact_lock.test.js" },
  { id: "P1.10", tier: "P1", sprint: "S45.7", version: "5.9.0", status: "delivered", title: "Suíte principal verde (1247 pass / 0 fail)", proof: "tests/dream_audit.test.js" },
  { id: "P1.11", tier: "P1", sprint: "S45.7", version: "5.9.0", status: "delivered", title: "Claims verificáveis (3 contratos mortos → REAL; guarda anti config-morta)", proof: "tests/claim_contract_integrity.test.js" },
  { id: "P1.12", tier: "P1", sprint: "S45.7", version: "5.9.0", status: "delivered", title: "Especialização honesta de agentes (generic_adapter/specialized/verified)", proof: "tests/agent_specialization.test.js" },
])

const byTier = (tier) => PRD45_RC_ITEMS.filter((i) => i.tier === tier)

/**
 * Prontidão de RC. `ready` exige TODOS os P0 `delivered`. Reporta P1 pendentes/parciais como
 * avisos honestos (não bloqueiam o RC — P0 é o gate — mas ficam registrados como incremento).
 */
export function prd45Readiness(items = PRD45_RC_ITEMS) {
  const p0 = items.filter((i) => i.tier === "P0")
  const p0Pending = p0.filter((i) => i.status !== "delivered")
  const p1Open = items.filter((i) => i.tier === "P1" && i.status !== "delivered")
  return {
    schemaVersion: PRD45_RC_CHECKLIST_SCHEMA,
    ready: p0Pending.length === 0,
    counts: { p0: p0.length, p0Delivered: p0.length - p0Pending.length, p1: byTier("P1").length, p1Open: p1Open.length },
    p0Pending: p0Pending.map((i) => i.id),
    p1Open: p1Open.map((i) => ({ id: i.id, status: i.status, title: i.title })),
    items,
  }
}
