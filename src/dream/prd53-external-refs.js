/**
 * Manifest de referências externas (PRD53 S53.0, §19 e §8.3.1).
 *
 * O §19 exige que cada referência externa traga URL, commit, licença,
 * maturidade, decisão e a proibição explícita de virar dependência runtime. E o
 * DoD é categórico sobre a consequência: **referência sem commit/licença/
 * disposition NÃO sustenta implementação**, e divergência de licença impede
 * vendoring até revisão explícita.
 *
 * O registry que existe (`.docs/RESEARCH/repository-registry.json`) guarda
 * `url`, `status`, `role`, `addedOn` e `note` — e nada mais. Medido, não
 * suposto: nenhuma das dez entradas tem commit, licença ou maturidade.
 *
 * Este módulo NÃO inventa os campos faltantes. Ele projeta cada referência na
 * forma do §19, marca o que falta e conclui o que a ausência implica:
 * `sustainsImplementation: false`. É a diferença entre um manifest que descreve
 * o mundo e um que o maquia — e maquiar aqui autorizaria vendoring de código
 * com licença desconhecida.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const EXTERNAL_REFS_SCHEMA = "gstack.prd53.external-refs.v1"

export const REGISTRY_PATH = join(".docs", "RESEARCH", "repository-registry.json")

/** Os campos que o §19 exige de TODA referência. */
export const CAMPOS_EXIGIDOS = Object.freeze(["url", "commit", "license", "maturity", "disposition"])

/** Os que, ausentes, derrubam `sustainsImplementation` — o DoD nomeia os três. */
export const CAMPOS_QUE_SUSTENTAM = Object.freeze(["commit", "license", "disposition"])

const lerRegistry = (repoRoot) => {
  const p = join(repoRoot, REGISTRY_PATH)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null }
}

/**
 * O `status` do registry é a DECISÃO já tomada sobre a referência, e por isso
 * serve de `disposition`. Os demais campos do §19 não existem lá — e o mapa não
 * os fabrica.
 */
const dispositionDe = (e) => e.status || null

/** Toda referência do registry: as soltas e as dos batches obrigatórios. */
function todasAsReferencias(registry) {
  const soltas = (registry.externalReferences || []).map((e) => ({ ...e, origin: "externalReferences" }))
  const deBatch = (registry.mandatoryBatches || []).flatMap((b) =>
    (b.repos || []).map((r) => ({ ...r, origin: `mandatoryBatches/${b.id}`, batchMandatoryFor: b.mandatoryFor || [] })))
  return [...soltas, ...deBatch]
}

/** Campo presente ou `null` — nunca `undefined`, que sumiria do JSON gravado. */
const ou = (v) => v || null

/** Por que o vendoring está bloqueado. Ausência de licença é pior que divergência. */
const motivoDoBloqueio = (license) => (license
  ? "revisão explícita de licença ainda não registrada"
  : "licença desconhecida — nem há o que comparar")

/** Projeta UMA referência na forma do §19, sem preencher o que não existe. */
export function projetarReferencia(e) {
  const projetada = {
    url: ou(e.url),
    commit: ou(e.commit),
    license: ou(e.license),
    maturity: ou(e.maturity),
    disposition: dispositionDe(e),
    role: ou(e.role),
    origin: e.origin,
    // A proibição do §1/§3 viaja COM o dado. Deixá-la só no PRD faria a regra
    // depender de quem lembrou de lê-la.
    runtimeDependencyForbidden: true,
  }
  const missing = CAMPOS_EXIGIDOS.filter((c) => !projetada[c])
  return {
    ...projetada,
    missingFields: missing,
    // A consequência, calculada e não sugerida: sem commit, licença e decisão,
    // a referência não sustenta implementação nenhuma.
    sustainsImplementation: CAMPOS_QUE_SUSTENTAM.every((c) => Boolean(projetada[c])),
    // Licença desconhecida NUNCA autoriza vendoring — o DoD trata divergência de
    // licença como bloqueio até revisão explícita, e ausência é pior que
    // divergência: nem dá para comparar.
    vendoringAllowed: false,
    vendoringBlockedReason: motivoDoBloqueio(projetada.license),
  }
}

export function manifestDeReferencias({ repoRoot = process.cwd(), commit = null } = {}) {
  const registry = lerRegistry(repoRoot)
  if (!registry) {
    return { schemaVersion: EXTERNAL_REFS_SCHEMA, sourceCommit: commit, registryPresent: false, references: [], counts: { total: 0, sustaining: 0 } }
  }
  const references = todasAsReferencias(registry).map(projetarReferencia)
  return {
    schemaVersion: EXTERNAL_REFS_SCHEMA,
    sourceCommit: commit,
    registryPresent: true,
    registryPath: REGISTRY_PATH,
    references,
    counts: {
      total: references.length,
      sustaining: references.filter((r) => r.sustainsImplementation).length,
      vendoringAllowed: references.filter((r) => r.vendoringAllowed).length,
    },
    doesNotAuthorize: [
      "nenhuma referência aqui é dependência runtime do GStack",
      "referência sem commit/licença/disposition não sustenta implementação (§19 DoD)",
      "vendoring exige revisão explícita de licença — ausência de licença bloqueia",
    ],
  }
}

const REGRAS = Object.freeze([
  { quando: (m) => !m.sourceCommit, problema: () => "sourceCommit ausente" },
  { quando: (m) => !m.registryPresent, problema: () => `registry ausente: ${REGISTRY_PATH}` },
  { quando: (m) => m.references.some((r) => !r.url), problema: () => "referência sem URL — não dá para auditar o que não tem endereço" },
  {
    quando: (m) => m.references.some((r) => r.runtimeDependencyForbidden !== true),
    problema: () => "referência sem a proibição de dependência runtime declarada",
  },
  {
    // Guarda contra maquiagem futura: `sustainsImplementation` só pode ser true
    // com os três campos presentes. Se alguém relaxar o cálculo, isto reprova.
    quando: (m) => m.references.some((r) => r.sustainsImplementation && CAMPOS_QUE_SUSTENTAM.some((c) => !r[c])),
    problema: () => "referência marcada como sustentando implementação sem commit/licença/disposition",
  },
])

export function problemasDoManifest(m) {
  if (!m || typeof m !== "object") return ["manifest não é objeto"]
  return REGRAS.filter((r) => r.quando(m)).map((r) => r.problema(m))
}
