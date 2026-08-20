/**
 * Inventário rastreável dos manuais (PRD53 S53.0, §19).
 *
 * O §1 do PRD53 é a regra que este módulo obedece: os manuais são fonte de
 * CURADORIA, não runtime. Uma recomendação só entra no core com oito elementos
 * (trigger, exclusões, decisão que altera, implementação, verificador, cenário
 * positivo e negativo, evidência de não-piora, rollback) — e nenhum deles se lê
 * num heading de markdown.
 *
 * Daí o desenho, que é deliberadamente pouco ambicioso: este inventário
 * CATALOGA e nunca promove. Toda seção substantiva sai com disposição
 * `human_reference / catalogued / missing`, que é o piso honesto, e o DoD do
 * §19 é atendido por isso — "toda seção substantiva tem disposition" não pede
 * que a disposição seja generosa.
 *
 * O que ele decide sozinho é só o que é estrutural: índice, sumário e exemplo
 * repetido NÃO viram prática. Essa é a única classificação automática, porque é
 * a única que se resolve pela forma do texto.
 *
 * O mapeamento para componentes canônicos sai como CANDIDATO, com o termo que o
 * casou. Um mapeamento automático tratado como autoridade seria promoção por
 * título com outro nome.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const MANUAL_INVENTORY_SCHEMA = "gstack.prd53.manual-inventory.v1"

/** Os manuais que o §1 nomeia. Lista FECHADA: outro arquivo não é fonte de curadoria. */
export const MANUAIS = Object.freeze([
  { id: "projetogstack", path: join(".docs", "PLANS", "projetogstack.md") },
  { id: "manual-engenharia", path: join(".docs", "PLANS", "manualdeengenhariacomia.md") },
])

/** Vocabulários do §6 — os três eixos, fechados. */
export const TREATMENTS = Object.freeze(["core", "conditional_question", "conditional_recipe", "human_reference"])
export const LIFECYCLES = Object.freeze([
  "catalogued", "candidate", "shadow_route", "shadow_execution", "promoted", "paused", "retired", "rejected",
])
export const CAPABILITY_STATES = Object.freeze(["implemented", "missing", "unsupported"])

/** Seções que NÃO são prática por FORMA — a única decisão automática legítima. */
export const MOTIVOS_NAO_PRATICA = Object.freeze([
  "index_or_toc", "title_only", "duplicate_content",
])

/** Componentes canônicos do §5, com os termos que sugerem cada um. */
export const COMPONENTES_CANONICOS = Object.freeze([
  { responsabilidade: "intake e decisões", componentes: ["src/project-plan/intake.js", "question-registry.js", "product-brief.js"], termos: ["intake", "pergunta", "decisão", "brief"] },
  { responsabilidade: "detecção e rota", componentes: ["src/skills/route.js", "gate-matrix.js"], termos: ["rota", "roteamento", "detecção"] },
  { responsabilidade: "verdade dos gates", componentes: ["src/skills/gate-registry.js", "gate-truth.js"], termos: ["gate", "portão", "quality gate"] },
  { responsabilidade: "execução", componentes: ["src/project-plan/golden-run.js", "run-loop.js"], termos: ["execução", "pipeline", "loop"] },
  { responsabilidade: "evidência", componentes: ["src/project-plan/evidence-ledger.js", "src/vfa/"], termos: ["evidência", "recibo", "auditoria"] },
  { responsabilidade: "conformance comportamental", componentes: ["src/skills/behavioral-conformance.js"], termos: ["conformance", "comportamental"] },
  { responsabilidade: "avaliação epistêmica", componentes: ["src/epistemic/benchmark.js"], termos: ["epistêmic", "benchmark", "hipótese"] },
  { responsabilidade: "aprendizado e dedupe", componentes: ["src/dream/candidate.js", "dedupe.js", "learning.js"], termos: ["aprendizado", "learning", "dedupe"] },
  { responsabilidade: "promoção e freshness", componentes: ["src/dream/promotion-gate.js", "freshness.js"], termos: ["promoção", "frescor", "freshness"] },
  { responsabilidade: "contexto de retomada", componentes: ["src/project-plan/context-delta.js"], termos: ["contexto", "retomada", "checkpoint"] },
])

const sha = (t) => `sha256:${createHash("sha256").update(t, "utf-8").digest("hex")}`

const slug = (titulo) => titulo
  .toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  .slice(0, 60)

const RX_HEADING = /^(#{1,6})\s+(.+?)\s*$/

/**
 * Fatia o markdown em seções por heading.
 *
 * A seção vai do heading até o próximo heading de qualquer nível — o corpo é o
 * que decide se ela é substantiva, e cortar por nível deixaria subseções
 * inteiras dentro do pai.
 */
export function seccionar(markdown) {
  const linhas = String(markdown).split("\n")
  const secoes = []
  let atual = null
  linhas.forEach((linha, i) => {
    const m = RX_HEADING.exec(linha)
    if (!m) { if (atual) atual.corpo.push(linha); return }
    if (atual) secoes.push(atual)
    atual = { level: m[1].length, title: m[2].trim(), line: i + 1, corpo: [] }
  })
  if (atual) secoes.push(atual)
  return secoes.map((s) => ({ ...s, body: s.corpo.join("\n").trim(), corpo: undefined }))
}

const RX_INDICE = /^(sum[áa]rio|[íi]ndice|table of contents|conte[úu]do)$/i
const ehIndice = (s) => RX_INDICE.test(s.title)
/** Só o título, sem corpo: não há o que catalogar. */
const soTitulo = (s) => s.body.length === 0

/**
 * Por que esta seção NÃO é prática — ou `null` quando ela é substantiva.
 *
 * `duplicate_content` compara o HASH do corpo: exemplo repetido em dois lugares
 * é o mesmo material, e catalogá-lo duas vezes inflaria o inventário com
 * trabalho imaginário.
 */
function motivoNaoPratica(secao, vistos) {
  if (ehIndice(secao)) return "index_or_toc"
  if (soTitulo(secao)) return "title_only"
  if (vistos.has(secao.bodyHash)) return "duplicate_content"
  return null
}

/** Componentes canônicos que o texto SUGERE — candidatos, nunca autoridade. */
function mapeamentoCandidato(texto) {
  const alvo = texto.toLowerCase()
  return COMPONENTES_CANONICOS
    .map((c) => ({ c, hits: c.termos.filter((t) => alvo.includes(t)) }))
    .filter(({ hits }) => hits.length > 0)
    .map(({ c, hits }) => ({ responsabilidade: c.responsabilidade, componentes: c.componentes, matchedTerms: hits }))
}

/**
 * A disposição de uma seção substantiva.
 *
 * SEMPRE o piso: `human_reference / catalogued / missing`. Promover exigiria os
 * oito elementos do §1, e nenhum deles é legível num heading — inferir qualquer
 * um seria exatamente a "promoção por título" que o DoD proíbe.
 */
const DISPOSICAO_PISO = Object.freeze({
  treatment: "human_reference",
  lifecycle: "catalogued",
  capabilityState: "missing",
  reason: "catalogado do manual; sem trigger, implementação e verificador declarados no produto (§1) não há promoção possível",
})

/** Inventaria UM manual. `absent: true` quando o arquivo não existe — nunca silencioso. */
export function inventariarManual(manual, { repoRoot = process.cwd() } = {}) {
  const abs = join(repoRoot, manual.path)
  if (!existsSync(abs)) return { ...manual, absent: true, sections: [] }
  const texto = readFileSync(abs, "utf-8")
  const vistos = new Set()
  const sections = seccionar(texto).map((s) => {
    const bodyHash = sha(s.body)
    const naoPratica = motivoNaoPratica({ ...s, bodyHash }, vistos)
    vistos.add(bodyHash)
    return {
      headingId: `${manual.id}#${slug(s.title)}`,
      title: s.title, level: s.level, line: s.line,
      bodyHash,
      substantive: naoPratica === null,
      notPracticeReason: naoPratica,
      disposition: naoPratica ? null : { ...DISPOSICAO_PISO },
      canonicalCandidates: naoPratica ? [] : mapeamentoCandidato(`${s.title}\n${s.body}`),
    }
  })
  return { ...manual, absent: false, fileHash: sha(texto), sections }
}

const contar = (secoes, pred) => secoes.filter(pred).length

/**
 * O inventário completo, com o SOURCE MANIFEST que o §19 pede.
 *
 * O manifest carrega o hash do arquivo inteiro e o de cada seção: sem isso,
 * "inventariado" seria uma afirmação sobre um texto que ninguém sabe qual era.
 */
export function inventarioDosManuais({ repoRoot = process.cwd(), commit = null } = {}) {
  const manuals = MANUAIS.map((m) => inventariarManual(m, { repoRoot }))
  const todas = manuals.flatMap((m) => m.sections)
  return {
    schemaVersion: MANUAL_INVENTORY_SCHEMA,
    sourceCommit: commit,
    generatedAt: new Date().toISOString(),
    sourceManifest: manuals.map((m) => ({ id: m.id, path: m.path, absent: m.absent, fileHash: m.fileHash || null, sections: m.sections.length })),
    counts: {
      sections: todas.length,
      substantive: contar(todas, (s) => s.substantive),
      notPractice: contar(todas, (s) => !s.substantive),
      promoted: contar(todas, (s) => s.disposition?.lifecycle === "promoted"),
    },
    manuals,
    // O §1 em uma linha, dentro do artefato: quem ler o JSON meses depois
    // precisa encontrar a regra junto com os dados.
    doesNotAuthorize: [
      "nenhuma seção vira prática do core por estar catalogada aqui",
      "o mapeamento canônico é CANDIDATO — não autoriza implementação",
      "promoção exige os oito elementos do §1, verificados contra o produto",
    ],
  }
}

const listaVazia = (v) => !Array.isArray(v) || v.length === 0

const REGRAS_DO_INVENTARIO = Object.freeze([
  { quando: (i) => !i.sourceCommit, problema: () => "sourceCommit ausente — inventário sem commit não diz de qual texto fala" },
  { quando: (i) => i.manuals.some((m) => m.absent), problema: (i) => `manual ausente: ${i.manuals.filter((m) => m.absent).map((m) => m.path).join(", ")}` },
  { quando: (i) => listaVazia(i.manuals[0]?.sections), problema: () => "nenhuma seção inventariada" },
  {
    // A guarda do DoD: nada promovido por título. Se um dia alguém acrescentar
    // promoção automática, isto reprova antes de o inventário virar autoridade.
    quando: (i) => i.counts.promoted > 0,
    problema: (i) => `${i.counts.promoted} seção(ões) promovida(s) pelo inventário — o §19 proíbe promoção por título`,
  },
  {
    quando: (i) => i.manuals.flatMap((m) => m.sections).some((s) => s.substantive && !s.disposition),
    problema: () => "seção substantiva sem disposition — o DoD exige disposição para TODA seção substantiva",
  },
  {
    quando: (i) => i.manuals.flatMap((m) => m.sections).some((s) => !s.substantive && !MOTIVOS_NAO_PRATICA.includes(s.notPracticeReason)),
    problema: () => "seção descartada por motivo fora do vocabulário fechado",
  },
])

export function problemasDoInventario(inv) {
  if (!inv || typeof inv !== "object") return ["inventário não é objeto"]
  return REGRAS_DO_INVENTARIO.filter((r) => r.quando(inv)).map((r) => r.problema(inv))
}
