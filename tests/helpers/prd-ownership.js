/**
 * Verificador de OWNERSHIP de contratos entre PRDs — função pura.
 *
 * Extraído para helper por um motivo específico: o controle negativo anterior
 * mutilava o documento e apenas confirmava que a mutilação ocorrera, sem NUNCA
 * executar a validação. Se o validador parasse de reprovar, o controle seguiria
 * verde — um teste que testava a si mesmo.
 *
 * Com o verificador isolado, o controle negativo o CHAMA com dado mutilado e
 * exige que ele devolva o problema. É a diferença entre "o dado mudou" e "a
 * checagem detecta a mudança".
 */

/** Divide markdown em seções por heading (h1–h3), preservando o corpo. */
export function secoesDe(texto) {
  const out = new Map()
  let atual = "(preambulo)"
  let buffer = []
  const guardar = () => out.set(atual, (out.get(atual) ?? "") + buffer.join("\n"))

  for (const linha of String(texto).split("\n")) {
    const h = linha.match(/^#{1,3}\s+(.+)/)
    if (!h) { buffer.push(linha); continue }
    guardar()
    atual = h[1].trim()
    buffer = [linha]
  }
  guardar()
  return out
}

/** Corpo da primeira seção cujo título começa com o prefixo. `null` se não há. */
export function secaoPorPrefixo(mapa, prefixo) {
  for (const [titulo, corpo] of mapa) {
    if (titulo.startsWith(prefixo)) return { titulo, corpo }
  }
  return null
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const contar = (texto, termo) =>
  (String(texto).match(new RegExp(escapar(termo), "gi")) || []).length

/**
 * Verifica a matriz de contratos contra os documentos.
 *
 * `docs` é `{ 52: texto, 53: texto, 54: texto }`. Devolve a LISTA de problemas —
 * vazia quando tudo confere. Nunca lança: quem chama decide o que fazer.
 *
 * DOIS REGIMES, porque os documentos têm dois tipos de contrato de verdade:
 *
 * **Exclusivo** (padrão) — o dono DEFINE e concentra; os demais no máximo citam:
 *   `secao_ausente`    — o contrato saiu da seção que o define
 *   `vazamento`        — aparece acima do teto num PRD que não é o dono
 *   `sem_concentracao` — outro PRD passou a concentrá-lo
 *
 * **Compartilhado** (`compartilhadoCom`) — vocabulário transversal que os três
 * documentos usam por design, e cuja contagem NÃO estabelece dono. Não é um
 * relaxamento: troca "concentra" por obrigações que o regime exclusivo não tem —
 * o termo precisa estar presente em CADA compartilhador declarado, e em nenhum
 * PRD fora da lista:
 *   `compartilhador_ausente`     — compartilhador declarado deixou de usar
 *   `compartilhamento_nao_declarado` — PRD fora da lista passou a usar
 *
 * Sem esse segundo regime, `sourceClass` — 1 ocorrência em cada PRD, nenhuma
 * delas uma definição — só passaria se a contagem fosse afrouxada, que é
 * exatamente o buraco por onde o ownership real escaparia.
 */
/** Âncora: o contrato precisa estar na seção que o DEFINE, não em qualquer uma. */
function checarSecaoAncora(mapaDono, { termo, dono, secao }) {
  const s = secaoPorPrefixo(mapaDono, secao)
  if (!s) return [{ tipo: "secao_inexistente", termo, dono, secao }]
  if (contar(s.corpo, termo) < 1) return [{ tipo: "secao_ausente", termo, dono, secao, titulo: s.titulo }]
  return []
}

/** Regime compartilhado: todo declarado usa, nenhum não-declarado usa. */
function checarCompartilhado(docs, { termo, dono, compartilhadoCom }) {
  const declarados = compartilhadoCom.map(String)
  const autorizados = new Set([String(dono), ...declarados])
  const ausentes = declarados
    .filter((p) => contar(docs[p], termo) < 1)
    .map((p) => ({ tipo: "compartilhador_ausente", termo, dono, outro: p }))
  const invasores = Object.keys(docs)
    .filter((p) => !autorizados.has(p))
    .map((p) => ({ p, n: contar(docs[p], termo) }))
    .filter(({ n }) => n > 0)
    .map(({ p, n }) => ({ tipo: "compartilhamento_nao_declarado", termo, dono, outro: p, n }))
  return [...ausentes, ...invasores]
}

/** Regime exclusivo: os outros no máximo citam, e o dono concentra. */
function checarExclusivo(docs, { termo, dono, maxOutros }) {
  const contagens = Object.keys(docs).map((p) => ({ p, n: contar(docs[p], termo) }))
  const vazamentos = contagens
    .filter(({ p, n }) => p !== String(dono) && n > maxOutros)
    .map(({ p, n }) => ({ tipo: "vazamento", termo, dono, outro: p, n, teto: maxOutros }))

  const lider = contagens.reduce((a, b) => (b.n > a.n ? b : a))
  if (lider.p !== String(dono)) {
    return [...vazamentos, { tipo: "sem_concentracao", termo, dono, lider: lider.p, n: lider.n }]
  }
  return vazamentos
}

export function verificarOwnership(docs, matriz) {
  const mapas = Object.fromEntries(Object.entries(docs).map(([p, t]) => [p, secoesDe(t)]))
  const regime = (c) => (c.compartilhadoCom ? checarCompartilhado : checarExclusivo)

  return matriz.flatMap((contrato) => [
    ...checarSecaoAncora(mapas[contrato.dono], contrato),
    ...regime(contrato)(docs, contrato),
  ])
}

/**
 * MATRIZ DE CONTRATOS APROVADOS, com a seção que DEFINE cada um.
 *
 * Extraída do mapeamento real dos três documentos — não de suposição. A primeira
 * versão cobria oito conceitos e deixava de fora contratos aprovados no relatório
 * comparativo: `sourceClass`, `evidenceKind`, controles de hooks/stdout,
 * `invocationAuthority`, AX, protótipo isolado, `contextPressure`, `effectState`
 * e `operatorRunbookRef`.
 */
export const MATRIZ_CONTRATOS = Object.freeze([
  // ── PRD52 — prova, certificação de hooks e canais ──────────────────────────
  { termo: "Claim Contract", dono: 52, secao: "22.2", maxOutros: 2 },
  { termo: "evidenceKind", dono: 52, secao: "22.2", maxOutros: 0 },
  { termo: "multiplicidade", dono: 52, secao: "24.3", maxOutros: 0 },
  { termo: "uninstall", dono: 52, secao: "15.", maxOutros: 2 },

  // ── PRD53 — governança de referências, autoridade de skills, avaliação ─────
  { termo: "reference_pack", dono: 53, secao: "8.3.1", maxOutros: 0 },
  // COMPARTILHADO por medição, não por conveniência: `sourceClass` aparece 1× em
  // cada PRD e nenhuma das três ocorrências é definição — são usos do mesmo
  // vocabulário de procedência (`primary_source|secondary_source`). Declarar o
  // PRD53 dono exclusivo seria inventar uma hierarquia que o texto não tem.
  { termo: "sourceClass", dono: 53, secao: "8.3.1", compartilhadoCom: [52, 54] },
  { termo: "SkillBinding", dono: 53, secao: "8.6", maxOutros: 0 },
  { termo: "invocationAuthority", dono: 53, secao: "8.6", maxOutros: 0 },
  { termo: "Scenario Lab", dono: 53, secao: "12. Scenario Lab", maxOutros: 0 },
  { termo: "Agent Experience (AX)", dono: 53, secao: "13.3.1", maxOutros: 0 },

  // ── PRD54 — Task Graph, lifecycle, handoff, protótipo ──────────────────────
  { termo: "Task Graph", dono: 54, secao: "7.2", maxOutros: 1 },
  { termo: "contextPressure", dono: 54, secao: "7.8", maxOutros: 0 },
  { termo: "protótipo", dono: 54, secao: "8.2", maxOutros: 1 },
  { termo: "drain", dono: 54, secao: "22.3", maxOutros: 0 },
  { termo: "failureScope", dono: 54, secao: "22.3", maxOutros: 0 },
  { termo: "effectState", dono: 54, secao: "22.3", maxOutros: 1 },
  { termo: "PendingRequirement", dono: 54, secao: "23.2", maxOutros: 1 },
  { termo: "operatorRunbookRef", dono: 54, secao: "23.2", maxOutros: 0 },
])
