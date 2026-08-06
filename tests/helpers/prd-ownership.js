/**
 * Verificador de OWNERSHIP de contratos entre PRDs — função pura.
 *
 * Extraído para helper por um motivo específico: o controle negativo original
 * mutilava o documento e apenas confirmava que a mutilação ocorrera, sem NUNCA
 * executar a validação. Se o validador parasse de reprovar, o controle seguiria
 * verde — um teste que testava a si mesmo.
 *
 * Com o verificador isolado, o controle negativo o CHAMA com dado mutilado e
 * exige que ele devolva o problema. É a diferença entre "o dado mudou" e "a
 * checagem detecta a mudança".
 *
 * Três correções da revisão (Task 1.3), todas de falso-verde:
 *  1. concentração era decidida por `reduce` com `>`, então EMPATE aprovava
 *     quem viesse primeiro na ordem das chaves — o PRD52 herdava 5/5/5 de graça.
 *     Agora o dono precisa de máximo ESTRITO, e a ordem deixou de importar.
 *  2. o regime compartilhado só ancorava o DONO: o termo podia migrar para
 *     qualquer seção dos demais compartilhadores e seguir verde. Agora cada
 *     compartilhador declara a SUA seção.
 *  3. âncora por prefixo casava mais de uma seção em silêncio (`Implementação`
 *     existe 2× no PRD52) e a primeira vencia. Agora há breadcrumb e
 *     ambiguidade é PROBLEMA, não desempate.
 */

/**
 * Divide markdown em seções por heading (h1–h3).
 *
 * Devolve array (não Map) porque títulos repetem — `Implementação` aparece duas
 * vezes no PRD52, e um Map colapsaria as duas numa entrada só, escondendo
 * exatamente a ambiguidade que precisa reprovar. Cada seção carrega o
 * `caminho` (breadcrumb até a raiz), que permite âncora não-ambígua.
 */
/** Remove da pilha os ancestrais que o novo heading fechou. */
function desempilharAte(pilha, nivel) {
  while (pilha.length > 0 && pilha[pilha.length - 1].nivel >= nivel) pilha.pop()
}

/** A seção corrente vira ancestral quando o novo heading é mais profundo. */
const ehAncestral = (secao, nivel) => secao.nivel > 0 && secao.nivel < nivel

export function secoesDe(texto) {
  const out = []
  const pilha = []
  let atual = { titulo: "(preambulo)", nivel: 0, linhas: [] }

  const fechar = () => out.push({
    titulo: atual.titulo,
    nivel: atual.nivel,
    caminho: [...pilha.map((s) => s.titulo), atual.titulo].filter((t) => t !== "(preambulo)").join(" > "),
    corpo: atual.linhas.join("\n"),
  })

  for (const linha of String(texto).split("\n")) {
    const h = linha.match(/^(#{1,3})\s+(.+)/)
    if (!h) { atual.linhas.push(linha); continue }
    fechar()
    const nivel = h[1].length
    desempilharAte(pilha, nivel)
    if (ehAncestral(atual, nivel)) pilha.push(atual)
    atual = { titulo: h[2].trim(), nivel, linhas: [linha] }
  }
  fechar()
  return out
}

/**
 * Seções que casam a âncora — por título (prefixo) ou por trecho do breadcrumb.
 * Pode devolver 0, 1 ou N; quem chama trata N>1 como PROBLEMA, nunca desempate.
 *
 * O caminho casa por `endsWith`, não por `includes`: a âncora aponta a seção em
 * si, não a subárvore. Com `includes`, `12. Scenario Lab` casava a seção E suas
 * sete subseções, e uma âncora de seção-pai perfeitamente legítima virava
 * ambiguidade. Já `Sprint 52.6 … > Implementação` continua desambiguando as duas
 * seções homônimas do PRD52, que é o caso que motivou o breadcrumb.
 */
export const secoesQueCasam = (secoes, ancora) =>
  secoes.filter((s) => s.titulo.startsWith(ancora) || s.caminho.endsWith(ancora))

/**
 * Compatibilidade: primeira seção que casa. Devolve `null` quando não há.
 * NÃO use para validar âncora — silencia ambiguidade. Use `checarSecaoAncora`.
 */
export function secaoPorPrefixo(secoes, ancora) {
  return secoesQueCasam(secoes, ancora)[0] ?? null
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const contar = (texto, termo) =>
  (String(texto).match(new RegExp(escapar(termo), "gi")) || []).length

const comoLista = (v) => (Array.isArray(v) ? v : [v])

/**
 * O contrato está na(s) seção(ões) que o DEFINE(m), sem ambiguidade de âncora.
 *
 * `secao` aceita array: `uninstall` é definido no §15 E nos controles negativos
 * do §24.5, e apontar só para o §15 deixava os acréscimos do addendum sem guarda.
 * TODAS as âncoras declaradas precisam conter o termo.
 */
function checarSecaoAncora(secoes, { termo, dono }, ancoras, prd = dono) {
  return comoLista(ancoras).flatMap((secao) => {
    const casam = secoesQueCasam(secoes, secao)
    if (casam.length === 0) return [{ tipo: "secao_inexistente", termo, dono, prd: String(prd), secao }]
    if (casam.length > 1) {
      return [{ tipo: "secao_ambigua", termo, dono, prd: String(prd), secao, casaram: casam.map((s) => s.caminho) }]
    }
    if (contar(casam[0].corpo, termo) < 1) {
      return [{ tipo: "secao_ausente", termo, dono, prd: String(prd), secao, titulo: casam[0].caminho }]
    }
    return []
  })
}

/**
 * Regime compartilhado: vocabulário transversal que os PRDs usam por design e
 * cuja contagem NÃO estabelece dono. Não é afrouxamento — troca "concentra" por
 * obrigações que o exclusivo não tem: cada compartilhador usa o termo NA SEÇÃO
 * QUE DECLAROU, e nenhum PRD fora da lista usa.
 */
function checarCompartilhado(docs, mapas, contrato) {
  const { termo, dono, compartilhadoCom } = contrato
  const declarados = Object.keys(compartilhadoCom).map(String)
  const autorizados = new Set([String(dono), ...declarados])

  // Dois modos de falha distintos, porque exigem correções distintas: o
  // compartilhador que ABANDONOU o termo deixou de compartilhar o vocabulário;
  // o que apenas o MOVEU continua usando, mas fora da seção que declarou.
  const semAncora = declarados.flatMap((p) => {
    if (!mapas[p] || contar(docs[p], termo) < 1) {
      return [{ tipo: "compartilhador_ausente", termo, dono, outro: p }]
    }
    return checarSecaoAncora(mapas[p], contrato, compartilhadoCom[p], p)
  })

  const invasores = Object.keys(docs)
    .filter((p) => !autorizados.has(p))
    .map((p) => ({ p, n: contar(docs[p], termo) }))
    .filter(({ n }) => n > 0)
    .map(({ p, n }) => ({ tipo: "compartilhamento_nao_declarado", termo, dono, outro: p, n }))

  return [...semAncora, ...invasores]
}

/**
 * Regime exclusivo: os demais no máximo citam, e o dono concentra ESTRITAMENTE.
 *
 * Empate não é concentração. A versão anterior usava `reduce` com `>`, que em
 * empate devolve o primeiro elemento — com dono na primeira posição, 5/5/5
 * passava. Aqui qualquer rival com contagem `>=` a do dono reprova, e a ordem
 * das chaves deixa de influenciar o veredito.
 */
function checarExclusivo(docs, { termo, dono, maxOutros }) {
  const contagens = Object.keys(docs).map((p) => ({ p, n: contar(docs[p], termo) }))
  const doDono = contagens.find(({ p }) => p === String(dono))
  const rivais = contagens.filter(({ p }) => p !== String(dono))

  const vazamentos = rivais
    .filter(({ n }) => n > maxOutros)
    .map(({ p, n }) => ({ tipo: "vazamento", termo, dono, outro: p, n, teto: maxOutros }))

  const empatados = rivais.filter(({ n }) => n >= doDono.n)
  if (empatados.length > 0) {
    const lider = empatados.reduce((a, b) => (b.n > a.n ? b : a))
    return [...vazamentos, { tipo: "sem_concentracao", termo, dono, lider: lider.p, n: lider.n, doDono: doDono.n }]
  }
  return vazamentos
}

/**
 * Verifica a matriz contra os documentos. `docs` é `{ 52: texto, ... }`.
 * Devolve a LISTA de problemas — vazia quando tudo confere. Nunca lança.
 */
export function verificarOwnership(docs, matriz) {
  const mapas = Object.fromEntries(Object.entries(docs).map(([p, t]) => [p, secoesDe(t)]))

  return matriz.flatMap((contrato) => [
    ...checarSecaoAncora(mapas[contrato.dono], contrato, contrato.secao),
    ...(contrato.compartilhadoCom
      ? checarCompartilhado(docs, mapas, contrato)
      : checarExclusivo(docs, contrato)),
  ])
}

/**
 * MATRIZ DE CONTRATOS APROVADOS, com a(s) seção(ões) que DEFINE(m) cada um.
 *
 * Extraída do mapeamento real dos três documentos — cada `secao` e cada
 * `maxOutros` foi medido, não suposto. Os termos do addendum §24 são FRASES,
 * não palavras: `ownership` sozinho aparece 8× no PRD52 espalhado por seções
 * não-normativas e não ancoraria nada; `ownership externo` ocorre uma vez, no
 * controle negativo que ele representa.
 */
export const MATRIZ_CONTRATOS = Object.freeze([
  // ── PRD52 — prova, certificação de instalação/upgrade e canais ─────────────
  { termo: "Claim Contract", dono: 52, secao: "22.2", maxOutros: 2 },
  { termo: "evidenceKind", dono: 52, secao: "22.2", maxOutros: 0 },
  { termo: "uninstall", dono: 52, secao: ["15.", "24.5"], maxOutros: 0 },

  // §24.3 — Golden E2E de pacote: hooks e canais protocolares
  { termo: "registro de hooks", dono: 52, secao: "24.3", maxOutros: 0 },
  { termo: "descoberta, invocacao", dono: 52, secao: "24.3", maxOutros: 0 },
  { termo: "multiplicidade", dono: 52, secao: "24.3", maxOutros: 0 },
  { termo: "restore dos hooks", dono: 52, secao: "24.3", maxOutros: 0 },
  { termo: "stdout protocolar", dono: 52, secao: "24.3", maxOutros: 0 },

  // §24.5 — Estados e controles negativos
  { termo: "stdout JSON/MCP", dono: 52, secao: "24.5", maxOutros: 0 },
  { termo: "payload protocolar", dono: 52, secao: "24.5", maxOutros: 0 },
  { termo: "ownership externo", dono: 52, secao: "24.5", maxOutros: 0 },
  { termo: "release_metadata_mismatch", dono: 52, secao: ["24.4", "24.5"], maxOutros: 0 },

  // ── PRD53 — governança de referências, autoridade de skills, avaliação ─────
  { termo: "reference_pack", dono: 53, secao: "8.3.1", maxOutros: 0 },
  // COMPARTILHADO por medição, não por conveniência: `sourceClass` aparece 1× em
  // cada PRD e nenhuma das três ocorrências é definição — são usos do mesmo
  // vocabulário de procedência. Declarar dono exclusivo inventaria uma
  // hierarquia que o texto não tem; cada um ancora onde de fato usa.
  {
    termo: "sourceClass",
    dono: 53,
    secao: "8.3.1",
    compartilhadoCom: {
      52: "13. Sprint 52.6 — Contexto, Graphify e closeout transacionais > Implementação",
      54: "10.1",
    },
  },
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
