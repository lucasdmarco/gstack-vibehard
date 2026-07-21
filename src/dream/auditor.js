import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { HARNESS_CAPABILITIES } from "./capabilities.js"
import { gradeClaimStatus, contractFor, NOT_PROVED } from "./claim-contract.js"

/**
 * Auditor anti-placebo (PRD Fase 3 §1). DETERMINÍSTICO, sem LLM, somente-leitura:
 * compara PROMESSAS (docs/CLAUDE.md/README) contra EVIDÊNCIA real no código.
 *
 * REGRA DE HONESTIDADE (v3.21.1): a evidência de REAL é SÓ o que o produto
 * PUBLICA no tarball npm (módulo de implementação + comando registrado + dados
 * shipados). NUNCA depende de `tests/` ou `.github/` — esses não viajam na
 * allowlist `files`, então usá-los como evidência faria o audit MENTIR (sub-
 * declarar capacidade real) em toda cópia instalada. Teste prova correção no CI;
 * não é evidência verificável pelo usuário final. Resultado: o mesmo placar
 * REAL/PARTIAL/PLACEBO/RISK no repo E em `npm i -g`.
 */
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function reader(root) {
  return {
    has: (rel) => existsSync(join(root, rel)),
    read: (rel) => { try { return readFileSync(join(root, rel), "utf-8") } catch { return "" } },
  }
}

// Um comando está "wired" no CLI se aparece no dispatcher. Suporta as duas formas:
// o switch/case legado (`case "verify"`) e o registry-map atual (entrada de metadados
// `name: "verify"` + chave `verify:` no DISPATCH). O refactor QG (PRD20 20.2) trocou o
// switch gigante por um mapa — a capacidade continua REAL, só mudou a sintaxe.
function cliHasCommand(read, cmd) {
  const src = read("src/cli/index.js")
  return src.includes(`case "${cmd}"`) || src.includes(`name: "${cmd}"`)
}

// 1. "Auto-dream ON" (CLAUDE.md) — só vira REAL com o ciclo improve+accept/reject.
function claimAutoDream(has, read) {
  const hasImprove = has("src/dream/runner.js") && cliHasCommand(read, "dream") && read("src/commands/dream.js").includes("improve")
  return {
    id: "auto-dream", claim: "Auto-dream ON (auto-melhoria)",
    status: hasImprove ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/commands/dream.js", "src/dream/auditor.js"].filter(has),
    missing: hasImprove ? [] : ["dream improve isolado", "accept/reject", "harness adapters"],
  }
}
// 2. Output Guard — pós-resposta (Stop hook) SEMPRE; pre-render existe como rota
// OPT-IN real (proxy de redaction + base-URL custom) onde o harness permite (PRD25
// 25.3). REAL exige capability E o proxy shipado; a nota impede vender Zero-Trust
// universal (harness sem base-URL segue só auditoria pós-resposta).
function claimOutputGuard(has) {
  const preOutput = Object.values(HARNESS_CAPABILITIES).some((c) => c.supportsPreOutputInterception)
  const proxyShipped = has("src/security/redact-proxy.js") && has("src/security/guard-status.js")
  const real = preOutput && proxyShipped
  return {
    id: "output-guard", claim: "Output Guard / Zero-Trust de saída",
    status: real ? "REAL" : "RISK", severity: "P1",
    evidence: ["hooks/hooks/_output_guard.py", "hooks/hooks/stop.py", "src/security/redact-proxy.js", "src/security/guard-status.js"].filter(has),
    missing: real ? [] : ["redaction pré-render (Stop hook é auditoria posterior)"],
    note: real ? "pre-render é OPT-IN via `gstack_vibehard proxy` + base-URL custom (claude/codex/opencode); cursor/instrucionais seguem auditoria pós-resposta — NÃO é Zero-Trust universal" : undefined,
  }
}
// 3. verify delivery gates — REAL (comando + runner shipado).
function claimVerify(has, read) {
  return {
    id: "verify", claim: "Delivery gates (verify) honestos",
    status: (cliHasCommand(read, "verify") && has("src/project-plan/verify-runner.js")) ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["src/commands/verify.js", "src/project-plan/verify-runner.js"].filter(has), missing: [],
  }
}
// 4. Manifest/backup/rollback — REAL.
function claimRollback(has, read) {
  return {
    id: "rollback", claim: "Instala tudo com rollback (manifest/backup)",
    status: (has("src/installer/safe-write.js") && has("src/installer/manifest.js") && cliHasCommand(read, "uninstall")) ? "REAL" : "PARTIAL",
    severity: "P2", evidence: ["src/installer/safe-write.js", "src/installer/manifest.js", "src/installer/integrity.js"].filter(has), missing: [],
  }
}
// 5. Cross-harness "Zero-Trust corporativo" — PARTIAL: há harness só instrucional.
function claimCrossHarnessTrust(has) {
  const weak = Object.values(HARNESS_CAPABILITIES).filter((c) => c.trustLevel !== "strong").map((c) => c.id)
  return {
    id: "cross-harness-trust", claim: "Segurança Zero-Trust cross-harness",
    status: "PARTIAL", severity: "P1",
    evidence: ["src/dream/capabilities.js", "src/harness/instructional.js"].filter(has),
    missing: [`harness best-effort não impõem gates: ${weak.join(", ")}`],
    // PRD25 25.5: PARTIAL aqui é o estado HONESTO por design — harness sem API de
    // hooks só recebe instrução best-effort. A separação enforced/advisory É a
    // feature; nunca vender "Zero-Trust universal". Docs/doctor refletem a matriz.
    note: "PARTIAL por design: enforced (hooks reais) vs advisory/instructional (best-effort) é separação deliberada — Zero-Trust universal não é um claim possível nem prometido",
  }
}
// 6. OpenCode safe — REAL (conservador); merge assistido JSONC ainda ROADMAP.
function claimOpencodeSafe(has, read) {
  const assisted = read("src/installer/doctor.js").includes("--fix")
  return {
    id: "opencode-safe", claim: "OpenCode sem sombrear .jsonc",
    status: has("src/harness/opencode-config.js") ? (assisted ? "REAL" : "PARTIAL") : "PLACEBO", severity: "P2",
    evidence: ["src/harness/opencode-config.js"].filter(has),
    missing: assisted ? [] : ["doctor --fix com merge assistido JSONC"],
  }
}
// 7. Loop Engineer task — REAL: executa o loop em WORKTREE (worktree→diff→hygiene→accept/reject).
function claimTaskLoop(has, read) {
  const ok = has("src/project-plan/task-loop.js") && has("src/commands/task-run.js") &&
    read("src/commands/task.js").includes("taskRunCommand")
  return {
    id: "task-loop", claim: "Loop Engineer (task) executa em worktree (diff/hygiene/accept/reject)",
    status: ok ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["src/project-plan/task-loop.js", "src/commands/task-run.js", "src/commands/task.js"].filter(has),
    missing: ok ? [] : ["execução do loop (worktree/diff/accept)"],
  }
}
// 8. Runtime Supervisor (PRD 12 PR4) — REAL: dev/stop sobem/derrubam serviços.
function claimRuntimeSupervisor(has, read) {
  const ok = cliHasCommand(read, "dev") && cliHasCommand(read, "stop") && has("src/runtime/supervisor.js") && has("src/runtime/ports.js")
  return {
    id: "runtime-supervisor", claim: "Runtime: dev/stop sobem e derrubam serviços",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/runtime/supervisor.js", "src/runtime/ports.js", "src/commands/runtime-supervisor.js"].filter(has),
    missing: ok ? [] : ["supervisor contínuo (restart/backoff/dependsOn) — hoje launch+readiness"],
  }
}
// 9. Secrets Broker (PRD 12 §10) — REAL: keychain do SO, sem .env.
function claimSecretsBroker(has, read) {
  const ok = cliHasCommand(read, "secrets") && has("src/secrets/broker.js") && has("src/secrets/providers.js") && has("src/secrets/schema.js")
  return {
    id: "secrets-broker", claim: "Secrets Broker (keychain do SO, sem .env)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/secrets/broker.js", "src/secrets/providers.js", "src/secrets/schema.js", "src/commands/secrets.js"].filter(has),
    missing: ok ? [] : ["providers por SO + comandos doctor/set/list/run"],
  }
}
// 10. Runtime Manifest V2 (PRD 12 PR3) — REAL: schema/migração/validação.
function claimRuntimeManifest(has) {
  return {
    id: "runtime-manifest", claim: "Runtime Manifest V2 (contrato do supervisor)",
    status: has("src/runtime/manifest.js") ? "REAL" : "PARTIAL",
    severity: "P2", evidence: ["src/runtime/manifest.js"].filter(has), missing: [],
  }
}
// 11. Package Manager Doctor (PRD 12 PR2) — REAL: resolver + doctor --package-manager.
function claimPackageManager(has, read) {
  return {
    id: "package-manager", claim: "Resolver de package manager (doctor --package-manager)",
    status: (has("src/installer/package-manager.js") && read("src/installer/doctor.js").includes("--package-manager")) ? "REAL" : "PARTIAL",
    severity: "P2", evidence: ["src/installer/package-manager.js"].filter(has), missing: [],
  }
}
// 12. Contrato Full sem degradação (PRD 12 §11) — REAL: gate + --allow-degraded.
function claimFullContract(has, read) {
  return {
    id: "full-contract", claim: "Full = tudo (bloqueia degradação silenciosa)",
    status: (has("src/installer/full-contract.js") && read("src/installer/install.js").includes("allow-degraded")) ? "REAL" : "PARTIAL",
    severity: "P1", evidence: ["src/installer/full-contract.js"].filter(has), missing: [],
  }
}
// 13. Agent Factory Contract (PRD 13 PR13.1) — REAL: fonte única → adapters, drift guard, Execution Contract.
function claimAgentFactory(has, read) {
  const ok = cliHasCommand(read, "agents") && has("src/agents/factory.js") &&
    read("agents/generated/manifest.json").includes('"schemaVersion": 2')
  return {
    id: "agent-factory", claim: "Agent Factory (fonte única → adapters; drift guard + Execution Contract)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/agents/factory.js", "scripts/scripts/build_agents.js", "src/commands/agents.js"].filter(has),
    missing: ok ? [] : ["manifest v2 + drift guard + comando agents"],
  }
}
// 14. AgentShield Blocking Build (PRD 13 PR13.2) — REAL: scan determinístico bloqueia injeção em build E --check.
function claimAgentShield(has, read) {
  const ok = has("src/agents/scanner.js") &&
    read("scripts/scripts/build_agents.js").includes("evaluateScan")
  return {
    id: "agentshield", claim: "AgentShield: scan determinístico bloqueia prompt-injection (build + --check)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/agents/scanner.js", "scripts/scripts/build_agents.js"].filter(has),
    missing: ok ? [] : ["scanner determinístico no build e no --check"],
  }
}
// 15. Adapter Capability Matrix honesta (PRD 13 PR13.3) — REAL: enforcement real por harness, sem Zero-Trust p/ instrucional.
function claimAdapterMatrix(has, read) {
  const ok = has("src/agents/adapter-matrix.js") && cliHasCommand(read, "agents")
  return {
    id: "adapter-matrix", claim: "Adapter matrix honesta (enforcement real; instrucional ≠ Zero-Trust)",
    status: ok ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["src/agents/adapter-matrix.js", "src/commands/agents.js"].filter(has),
    missing: ok ? [] : ["matriz de enforcement + copilot/gemini gerados"],
  }
}
// 16. QA Multi-Lens (PRD 12 B2) — REAL: lentes determinísticas sobre o diff (veredito sem LLM).
function claimQaMultiLens(has, read) {
  const ok = has("src/project-plan/qa-lenses.js") && cliHasCommand(read, "qa")
  return {
    id: "qa-multi-lens", claim: "QA Multi-Lens determinístico (eval/any/secret/query/shell) sobre o diff",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/project-plan/qa-lenses.js", "src/commands/qa.js"].filter(has),
    missing: ok ? ["Audit Agents sobre provenance chegam com a VFA (C1)"] : ["lentes determinísticas + comando qa"],
  }
}
// 17. VFA Provenance (PRD 13 PR13.4) — REAL: recibos com hash-chain; audit verify pega adulteração.
const hasVfaProvenance = (has, read) =>
  has("src/vfa/attestation.js") && has("src/vfa/provenance.js") && cliHasCommand(read, "audit")
function claimVfaProvenance(has, read) {
  const ok = hasVfaProvenance(has, read)
  return {
    id: "vfa-provenance", claim: "VFA: provenance hash-chain + attestation (audit verify pega adulteração)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/vfa/attestation.js", "src/vfa/provenance.js", "src/commands/audit.js"].filter(has),
    missing: ok ? ["challenge-response (C2) + auditores determinísticos sobre o log"] : ["attestation + provenance + audit"],
  }
}
// 18. Challenge-Response (PRD 13 PR13.5) — REAL: ação de alto risco exige evidência; instrucional=posthoc.
function claimChallengeResponse(has, read) {
  const ok = has("src/vfa/challenge.js") && cliHasCommand(read, "challenge")
  return {
    id: "challenge-response", claim: "Challenge-Response (alto risco exige backup/manifest/rollback; instrucional=posthoc_audit_only)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/vfa/challenge.js", "src/commands/challenge.js"].filter(has),
    missing: ok ? ["enforcement no pre-tool hook Python (refinamento)"] : ["classifier + challenge + deny"],
  }
}
// 19. Meta-Harness MVP (PRD 13 PR13.6) — REAL: executor+verifier independente, dupla verificação (QG decide).
function claimMetaHarness(has, read) {
  const ok = has("src/meta/orchestrator.js") && cliHasCommand(read, "orchestrate")
  return {
    id: "meta-harness", claim: "Meta-Harness (executor em worktree + verifier independente; QG decide, LLM advisory)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/meta/orchestrator.js", "src/commands/orchestrate.js"].filter(has),
    missing: ok ? ["reviewer LLM real plugável (hoje advisory no-op) + multi-harness paralelo"] : ["orchestrator + dupla verificação"],
  }
}
// 20. Type safety + coverage + bench (PRD 12 B3 / PR10) — REAL: .d.ts dos contratos + gate c8 ≥70% + bench.
function claimTypeCoverage(has, read) {
  const ok = has("types/contracts.d.ts") && has("scripts/bench.mjs") && read("package.json").includes("coverage:ci")
  return {
    id: "type-coverage", claim: "Tipos dos contratos (.d.ts) + coverage gate c8 (≥70%) + benchmarks",
    status: ok ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["types/contracts.d.ts", "jsconfig.json", "scripts/bench.mjs"].filter(has),
    missing: ["gate `checkJs` full (adoção incremental de JSDoc nos options-bags)"],
  }
}
// 21. Security & Governance Pack (PRD 12 PR9). .github/CODEOWNERS e codeql.yml NÃO
// viajam no tarball; evidência shipada = SECURITY.md + THREAT_MODEL.md + script sbom.
function claimGovernance(has, read) {
  const ok = has("SECURITY.md") && has("THREAT_MODEL.md") && read("package.json").includes("\"sbom\"")
  return {
    id: "governance", claim: "Governance pack (SECURITY, threat model, CODEOWNERS, CodeQL, SBOM)",
    status: ok ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["SECURITY.md", "THREAT_MODEL.md", ".github/workflows/codeql.yml"].filter(has),
    missing: [],
  }
}

// PRD45 S45.7 (P1.11): claims que faltavam para os contratos comportamentais VINCULAREM. As
// capacidades existem e têm teste de controle negativo (declarado no contrato) — sem o claim,
// `contractFor()` nunca as alcançava e viravam config morta. Com o claim + contrato completo,
// graduam REAL (prova comportamental de verdade, não presença de arquivo).
// 22. QA Lens visual (S41.6) — REAL: screenshot/a11y/500 reprovam por motivos distintos.
function claimQaLens(has, read) {
  const ok = has("src/skills/visual-gate.js") && cliHasCommand(read, "loop")
  return {
    id: "qa-lens", claim: "QA Lens visual (screenshot + a11y + status HTTP; 500/a11y/screenshot ausente falham distinto)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/skills/visual-gate.js", "src/commands/loop.js"].filter(has),
    missing: ok ? [] : ["visual-gate + comando loop observe"],
  }
}
// 23. Action Kernel (S41.5) — REAL: ação governada negada NÃO executa (Gate Registry).
function claimActionKernel(has, read) {
  const ok = has("src/skills/action-kernel.js") && cliHasCommand(read, "actions")
  return {
    id: "action-kernel", claim: "Action Kernel: ação governada (task/workflow/delegate); ação negada NÃO executa",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/skills/action-kernel.js", "src/commands/actions.js"].filter(has),
    missing: ok ? [] : ["action-kernel + Gate Registry"],
  }
}
// 24. Loop Checkpoint (S41.7) — REAL: tamper/traversal/.env abortam o restore.
function claimLoopCheckpoint(has, read) {
  const ok = has("src/skills/loop-checkpoint.js") && cliHasCommand(read, "loop")
  return {
    id: "loop-checkpoint", claim: "Loop Checkpoint/rollback seguro (tamper/traversal/.env abortam)",
    status: ok ? "REAL" : "PARTIAL", severity: "P1",
    evidence: ["src/skills/loop-checkpoint.js", "src/commands/loop.js"].filter(has),
    missing: ok ? [] : ["loop-checkpoint + containment"],
  }
}

// 25. Freshness/revogação (S46.6) — conhecimento aprendido expira; revogação preserva
// provenance. Sem contrato comportamental ainda (nenhum comando CLI de revoke/stale
// wired de ponta a ponta) — vira NOT_PROVED em modo comportamental, honestamente.
function claimDreamFreshness(has, read) {
  const ok = has("src/dream/freshness.js") && cliHasCommand(read, "dream") && read("src/commands/dream.js").includes("metrics")
  return {
    id: "dream-freshness", claim: "Conhecimento aprendido expira (freshness) e revogação preserva provenance",
    status: ok ? "REAL" : "PARTIAL", severity: "P2",
    evidence: ["src/dream/freshness.js", "src/commands/dream.js"].filter(has),
    missing: ok ? [] : ["freshness.js + dream metrics"],
  }
}

// Ordem preservada (o placar e os testes dependem dela).
const CLAIM_BUILDERS = [
  claimAutoDream, claimOutputGuard, claimVerify, claimRollback, claimCrossHarnessTrust,
  claimOpencodeSafe, claimTaskLoop, claimRuntimeSupervisor, claimSecretsBroker, claimRuntimeManifest,
  claimPackageManager, claimFullContract, claimAgentFactory, claimAgentShield, claimAdapterMatrix,
  claimQaMultiLens, claimVfaProvenance, claimChallengeResponse, claimMetaHarness, claimTypeCoverage,
  claimGovernance, claimQaLens, claimActionKernel, claimLoopCheckpoint, claimDreamFreshness,
]
function tallySummary(claims) {
  const summary = { REAL: 0, PARTIAL: 0, PLACEBO: 0, ROADMAP: 0, RISK: 0 }
  for (const c of claims) summary[c.status] = (summary[c.status] || 0) + 1
  return summary
}
// CM-08 (PRD26): declara O QUE está sendo auditado — o PACOTE gstack (instalado ou
// repo-fonte) vs um diretório qualquer. Auditar de `C:\Users\x>` audita o pacote
// instalado, não um projeto local; o `scope` torna isso explícito no JSON.
function auditScope(root) {
  let pkgName = null
  try { pkgName = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).name || null } catch { /* sem package.json */ }
  return {
    root: String(root),
    target: pkgName === "@gstack-vibehard/installer" ? "gstack_package" : "directory",
    packageName: pkgName,
    note: "as evidências (src/..., hooks/...) são relativas ao root auditado",
  }
}

// PRD41 S41.9 (P1.6): rebaixa REAL sem contrato comportamental para NOT_PROVED.
function applyBehavioral(claim) {
  const status = gradeClaimStatus(claim.status, contractFor(claim.id))
  return status === claim.status ? claim : { ...claim, status, notProved: status === NOT_PROVED }
}

export function audit(opts = {}) {
  const root = opts.root || DEFAULT_ROOT
  const { has, read } = reader(root)
  const raw = CLAIM_BUILDERS.map((build) => build(has, read))
  const claims = opts.behavioral ? raw.map(applyBehavioral) : raw
  return { generatedAt: new Date().toISOString(), root: ".", behavioral: Boolean(opts.behavioral), scope: auditScope(root), claims, summary: tallySummary(claims) }
}
