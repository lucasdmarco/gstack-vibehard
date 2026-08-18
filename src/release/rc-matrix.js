/**
 * Matriz de Release Candidate (PRD51 S51.10.2, §51.10 "Matriz mínima").
 *
 * O §51.10 lista 10 dimensões que o RC precisa provar. O risco óbvio era declarar
 * cobertura por INFERÊNCIA — "existe um job de CI chamado `test` em três SOs, logo a
 * matriz está coberta". Este módulo faz o oposto, na mesma disciplina do
 * `meta/operation-registry.js` (S51.4.5): cada dimensão foi auditada contra o teste ou
 * job REAL que a sustenta, e o que não é coberto sai declarado como lacuna, com o motivo.
 *
 * Vocabulário fechado:
 *   proven  — há teste/job real cobrindo a dimensão como o §51.10 a descreve;
 *   partial — coberta, mas mais estreita que o enunciado; o estreitamento fica escrito;
 *   missing — nada cobre. Nunca preenchido com aproximação para melhorar o placar.
 *
 * O que este módulo NÃO faz: rodar a matriz. É um registro auditável do que a suíte e a
 * CI provam hoje. Executar a matriz nos três sistemas é da CI (`.github/workflows`), e as
 * caixas `runtime` do DoD (`rc-checklist-prd51.js`) continuam pendentes até rodarem no
 * commit final do RC — um registro dizendo "coberto" nunca substitui a execução.
 */
export const RC_MATRIX_SCHEMA = "gstack.rc-matrix.v1"

export const RC_MATRIX_STATUSES = Object.freeze(["proven", "partial", "missing"])

export const RC_MATRIX = Object.freeze([
  {
    id: "os",
    dimension: "Windows, macOS e Linux",
    status: "proven",
    ci: ["test.yml:doctor", "test.yml:test", "test.yml:e2e"],
    provedBy: [],
    gap: null,
  },
  {
    id: "node-versions",
    dimension: "Node suportado mínimo, LTS atual e versão usada no release",
    status: "partial",
    ci: ["test.yml:doctor", "test.yml:test", "test.yml:test-node-next", "runtime-compat.yml"],
    provedBy: [],
    gap: "ATUALIZADO NA CERTIFICAÇÃO (2026-08-03) — o gate é ESTRUTURALMENTE INVÁLIDO, ver `P0.NODE-SUPPORT-GATE-INVALID` em rc-checklist-prd51.js. O S51.10.2 criou `test-node-matrix` para rodar a suíte inteira no mínimo (18) e no LTS (20), justamente porque 'uma regressão exclusiva do Node 18 passaria batido'. Medição direta em Node 18.20.8 real: 208 pass / 352 fail de 561, causa única `import.meta.dirname` (Node >= 20.11) em 351 arquivos de teste. Um gate que reprova por incompatibilidade estrutural da suíte não sinaliza regressão alguma — é ruído constante, indistinguível de gate ausente. Logo: o gate mede a SUÍTE, não o runtime. ATUALIZADO 2026-08-05 — a matriz da Trilha B2 mediu o RUNTIME: pacote real, instalação offline, tarball de árvore limpa (commit e5b832d), 10 oráculos semânticos por versão, Nodes portáteis com SHA-256 conferido. As quatro linhas deram `runtime_compatible` no Windows, com degradação DECLARADA do State Store em 18/20 (`sqlite` ausente → `jsonl_fallback`, autorizada pela capacidade observada). A hipótese de incompatibilidade foi REFUTADA. Segue `partial` por dois motivos honestos: (a) cobertura de UM SO — `runtime-compat.yml` existe mas nunca rodou no GitHub, então Linux/macOS são `unproven`; (b) a suíte continua quebrada em 18/20, o que por regra acordada limita esses runtimes a `best_effort`, nunca suporte oficial. Evidência: .docs/RESEARCH/prd51-runtime-matrix-20260805.md. DECISÃO TOMADA 2026-08-17 — `safe_support = node22_official_only`: Node >=22 é suporte OFICIAL; Node 18/20 ficam `best_effort` com a claim exata `runtime_compatible_windows_local`, porque RODAM sem que a suíte passe e estão fora de suporte upstream. Rodar não é ser suportado. Segue `partial` por DOIS motivos, nenhum deles a decisão: cross-OS segue `unproven` e nada será afirmado sobre Linux/macOS antes de `runtime-compat.yml` rodar de verdade no GitHub. COERÊNCIA APLICADA no mesmo dia: `engines` foi para `>=22`, `node-health.js` passou a ter DOIS níveis (`official` >=22, `best_effort` 18/20 com aviso e sem bloqueio, `unmeasured` <18 bloqueando), e o job de suíte em 18/20 saiu — exigir suíte verde de versão declarada `best_effort` era o job vermelho por construção que abriu este achado. A cobertura de 18/20 permanece onde a claim é verdadeira: o job `doctor` EXECUTA o produto neles, em três SOs.",
  },
  {
    id: "lite-full",
    dimension: "Lite e Full",
    status: "proven",
    ci: ["test.yml:test"],
    provedBy: ["tests/lite_mode.test.js", "tests/full_contract.test.js", "tests/create_lite_capabilities.test.js"],
    gap: null,
  },
  {
    id: "new-vs-brownfield",
    dimension: "projeto novo e brownfield com Git dirty",
    status: "proven",
    ci: ["test.yml:test"],
    provedBy: ["tests/start_brownfield.test.js", "tests/brownfield_discovery.test.js"],
    gap: null,
  },
  {
    id: "harnesses",
    dimension: "Claude, Codex e OpenCode em modo que a CI puder provar honestamente",
    status: "proven",
    ci: ["test.yml:test"],
    provedBy: ["tests/harness_conformance_matrix.test.js", "tests/doctor_harness_matrix.test.js", "tests/codex_trust.test.js", "tests/enforcement_scope.test.js"],
    gap: null,
  },
  {
    id: "optional-tools-absent",
    dimension: "ausência de ferramentas opcionais",
    status: "proven",
    ci: ["test.yml:test"],
    provedBy: ["tests/tool_readiness.test.js", "tests/opencode_plugin_degraded.test.js", "tests/full_contract.test.js"],
    gap: null,
  },
  {
    id: "network-failure",
    dimension: "falha de rede",
    status: "missing",
    ci: [],
    provedBy: [],
    gap: "Nenhum teste exercita falha de rede real. Os comandos que tocam rede (`research --repo`, conectores, MCP) não têm ponto de injeção para simular ENOTFOUND/ECONNREFUSED sem bater na rede de verdade. Fabricar um mock que só prova o mock seria pior que declarar a lacuna. Fechar isso exige ponto de injeção no cliente HTTP/git — mudança estrutural, fora do escopo do RC.",
  },
  {
    id: "stop-restart",
    dimension: "stop/restart",
    status: "proven",
    ci: ["test.yml:test"],
    provedBy: ["tests/runtime_stop_ownership.test.js", "tests/runtime_windows_reconcile.test.js", "tests/runtime_e2e.test.js"],
    gap: null,
  },
  {
    id: "rollback-uninstall",
    dimension: "rollback/uninstall",
    status: "proven",
    ci: ["test.yml:test"],
    provedBy: ["tests/uninstall_restore.test.js", "tests/uninstall_unregister.test.js", "tests/restore_provenance.test.js", "tests/install_global_consent.test.js"],
    gap: null,
  },
  {
    id: "json-contract",
    dimension: "JSON contract",
    status: "partial",
    ci: ["test.yml:test"],
    provedBy: ["tests/doctor_json.test.js", "tests/prd_status_command.test.js", "tests/start_pipeline.test.js"],
    gap: "A pureza de stdout é provada comando a comando, onde alguém lembrou de provar. Não existe varredura que pegue TODO comando que anuncia `--json` e verifique que a saída parseia — é a mesma lacuna registrada em DOD.13. Exigiria catálogo de flags por comando, que o S51.4.5 já declarou inexistente.",
  },
])

const byStatus = (s) => RC_MATRIX.filter((d) => d.status === s)

/**
 * Veredito da matriz. `complete` só é `true` sem NENHUMA dimensão `missing` ou `partial` —
 * "quase toda a matriz" não é a matriz. `open` sai com o motivo de cada lacuna para que o
 * RC decida com o texto na mão, não com um número.
 */
export function rcMatrixVerdict(matrix = RC_MATRIX) {
  const missing = matrix.filter((d) => d.status === "missing")
  const partial = matrix.filter((d) => d.status === "partial")
  return {
    schemaVersion: RC_MATRIX_SCHEMA,
    complete: missing.length === 0 && partial.length === 0,
    counts: {
      total: matrix.length,
      proven: matrix.filter((d) => d.status === "proven").length,
      partial: partial.length,
      missing: missing.length,
    },
    open: [...missing, ...partial].map((d) => ({ id: d.id, dimension: d.dimension, status: d.status, gap: d.gap })),
  }
}

/** Dimensões por status — usado por testes e por quem monta o relatório do RC. */
export const provenDimensions = () => byStatus("proven").map((d) => d.id)
