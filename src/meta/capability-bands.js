import { PROOF_GATES } from "../skills/gate-registry.js"
import { CLAIM_CONTRACTS } from "../dream/claim-contract.js"
import { PENDING_FEATURES } from "../project-plan/pending-features.js"

/**
 * Matriz de capacidades em 5 faixas (PRD51 S51.10.4, §51.10 item 2 dos Manuais).
 *
 * O PRD pede a matriz `entregue | enforced | advisory | experimental | roadmap` como
 * REGISTRO INTERNO de claims, cuja função é impedir documentação pública enganosa.
 *
 * A tentação era escrever a matriz à mão no manual. Seria repetir exatamente a doença que
 * este sprint existe para curar: o manual está com baseline v5.19.0 justamente porque
 * texto escrito à mão envelhece em silêncio. Aqui as faixas são DERIVADAS dos registries
 * que já são autoridade no repositório, então a matriz não pode divergir do código sem
 * que o código mude junto:
 *
 *   entregue  ← CLAIM_CONTRACTS   (claim com contrato comportamental: adapter de
 *                                  evidência + comando E2E + controle negativo)
 *   enforced  ← PROOF_GATES       severity `hard` — bloqueia de verdade
 *   advisory  ← PROOF_GATES       severity `advisory` — reporta e não bloqueia
 *   roadmap   ← PENDING_FEATURES  declarado e reconhecidamente não implementado
 *
 * LACUNA REAL E DECLARADA: `experimental` NÃO tem fonte legível por máquina. O
 * vocabulário existe (`OBLIGATIONS` em capabilities/contract.js inclui "experimental"),
 * mas nada o popula — hoje "experimental" só aparece como prosa em texto de ajuda
 * (`research.js`). As entradas abaixo foram extraídas dessas declarações REAIS em código,
 * uma a uma, e ficam explicitamente marcadas como declaração manual até existir registro.
 * Inventar um registro só para a matriz ficar simétrica seria produzir a mesma claim
 * não-verificável que o PRD51 combate.
 */
export const CAPABILITY_BANDS_SCHEMA = "gstack.capability-bands.v1"

export const BANDS = Object.freeze(["entregue", "enforced", "advisory", "experimental", "roadmap"])

/**
 * `experimental` declarado à mão, com a fonte em código de cada item. Enquanto não houver
 * registro real, esta lista é a única honesta — e sai marcada como `derived:false` para
 * que ninguém a confunda com as faixas derivadas.
 */
export const EXPERIMENTAL_DECLARED = Object.freeze([
  {
    id: "research-notebooklm",
    label: "Conector NotebookLM",
    source: "src/commands/research.js — o próprio help declara \"conector experimental (cloud, não-oficial)\"",
  },
  {
    id: "notebooklm-query",
    label: "Query do NotebookLM",
    source: "src/tools/notebooklm.js — \"sem ambiente Python real pinado, sempre degrada honestamente\"",
  },
])

const gatesBySeverity = (sev) => PROOF_GATES
  .filter((g) => g.severity === sev)
  .map((g) => ({
    id: g.id,
    appliesTo: Array.isArray(g.appliesTo) ? g.appliesTo.join("/") : g.appliesTo,
    negativeControl: g.negativeControl,
  }))

const deliveredClaims = () => Object.entries(CLAIM_CONTRACTS).map(([id, c]) => ({
  id,
  evidenceAdapter: c.evidenceAdapter,
  e2eCommand: c.e2eCommand,
  negativeControl: c.negativeControl,
}))

const roadmapItems = () => Object.values(PENDING_FEATURES).map((f) => ({
  id: f.id,
  label: f.label,
  explanation: f.explanation,
}))

/**
 * Monta a matriz. `derived:true` significa que a faixa veio de um registry do repositório
 * e não pode divergir do código em silêncio; `derived:false` é declaração manual, com a
 * razão registrada. A distinção é o ponto — uma matriz que não diz de onde veio cada
 * faixa é indistinguível de uma escrita de memória.
 */
export function buildCapabilityBands() {
  return {
    schemaVersion: CAPABILITY_BANDS_SCHEMA,
    bands: {
      entregue: { derived: true, source: "src/dream/claim-contract.js (CLAIM_CONTRACTS)", items: deliveredClaims() },
      enforced: { derived: true, source: "src/skills/gate-registry.js (PROOF_GATES severity=hard)", items: gatesBySeverity("hard") },
      advisory: { derived: true, source: "src/skills/gate-registry.js (PROOF_GATES severity=advisory)", items: gatesBySeverity("advisory") },
      experimental: {
        derived: false,
        source: "declaração manual — não há registro legível por máquina (OBLIGATIONS existe mas ninguém o popula)",
        items: [...EXPERIMENTAL_DECLARED],
      },
      roadmap: { derived: true, source: "src/project-plan/pending-features.js (PENDING_FEATURES)", items: roadmapItems() },
    },
  }
}

const linhaClaim = (i) => `| \`${i.id}\` | ${i.evidenceAdapter} | \`${i.e2eCommand}\` | ${i.negativeControl} |`
const linhaGate = (i) => `| \`${i.id}\` | ${i.appliesTo} | ${i.negativeControl} |`
const linhaExperimental = (i) => `| ${i.label} | ${i.source} |`
const linhaRoadmap = (i) => `| ${i.label} | ${i.explanation} |`

/** Uma seção = título + prosa + tabela. Extraído por CC (5 loops cruzavam o limiar). */
const secao = (titulo, prosa, colunas, itens, linha) => [
  titulo,
  "",
  ...prosa,
  "",
  `| ${colunas.join(" | ")} |`,
  `|${colunas.map(() => "---").join("|")}|`,
  ...itens.map(linha),
  "",
]

const cabecalho = (cliVersion) => [
  `### Matriz de capacidades — derivada do código${cliVersion ? ` (CLI v${cliVersion})` : ""}`,
  "",
  "> Seção GERADA por `node scripts/capability-bands.mjs --write`. Não editar à mão:",
  "> cada faixa é derivada de um registry real, exceto onde marcado. Editar aqui",
  "> reintroduz exatamente o drift que fez este manual ficar preso na v5.19.0.",
  "",
]

/**
 * Renderiza a matriz em Markdown para embutir no manual interno. O manual NÃO é
 * empacotado nem carregado em runtime — este render existe para que a seção do manual
 * seja REGENERADA em vez de reescrita à mão a cada release.
 */
export function renderCapabilityBandsMarkdown(bands = buildCapabilityBands(), cliVersion = "") {
  const b = bands.bands
  return [
    ...cabecalho(cliVersion),
    ...secao(
      `#### entregue — ${b.entregue.items.length} claims com contrato comportamental`,
      [`Fonte: \`${b.entregue.source}\`. Cada linha liga a claim ao código que produz a`,
        "evidência, ao comando que a exercita e ao controle negativo que a reprova."],
      ["Claim", "Adapter de evidência", "Comando", "Controle negativo"],
      b.entregue.items, linhaClaim,
    ),
    ...secao(
      `#### enforced — ${b.enforced.items.length} gates que BLOQUEIAM`,
      [`Fonte: \`${b.enforced.source}\`.`],
      ["Gate", "Perfis", "Controle negativo"],
      b.enforced.items, linhaGate,
    ),
    ...secao(
      `#### advisory — ${b.advisory.items.length} gates que REPORTAM e não bloqueiam`,
      [`Fonte: \`${b.advisory.source}\`. Advisory nunca vira enforcement por omissão.`],
      ["Gate", "Perfis", "Controle negativo"],
      b.advisory.items, linhaGate,
    ),
    ...secao(
      `#### experimental — ${b.experimental.items.length} (declaração manual)`,
      [`**Não derivado.** ${b.experimental.source}. Cada item cita a declaração real em código.`],
      ["Capacidade", "Onde está declarado"],
      b.experimental.items, linhaExperimental,
    ),
    ...secao(
      `#### roadmap — ${b.roadmap.items.length} declarados e NÃO implementados`,
      [`Fonte: \`${b.roadmap.source}\`. Roadmap não é produto.`],
      ["Item", "Estado"],
      b.roadmap.items, linhaRoadmap,
    ),
  ].join("\n")
}
