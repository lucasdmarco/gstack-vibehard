import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  verificarOwnership, secoesDe, secaoPorPrefixo, contar, MATRIZ_CONTRATOS,
} from "./helpers/prd-ownership.js"

/**
 * Achados externos dos PRDs 52–54 — governança do registro.
 *
 * O relatório `.docs/RESEARCH/prd52-54-external-agent-methods-20260805.md`
 * distribui ideias observadas em Matt Pocock Skills, AI Hero e LiveKit Agents
 * entre três PRDs. Este teste guarda duas coisas que se perdem com facilidade:
 *
 *  1. **OWNERSHIP, não presença.** Não basta um conceito aparecer em algum
 *     lugar: ele precisa estar no PRD DONO. Sem isso, `Task Graph` migraria
 *     para o PRD52 numa edição distraída e ninguém notaria — cada PRD passaria
 *     a decidir sobre o território do outro.
 *  2. **Toda fonte citada existe no registry, com a disposição declarada.**
 *     Um repo `archived_reference` é contexto histórico e NUNCA fundamenta
 *     decisão atual; se virasse `active` sem revisão, o relatório passaria a
 *     citar como vivo o que foi arquivado de propósito.
 *
 * `.docs/` é gitignored no repositório — estes quatro documentos são versionados
 * com `git add -f` porque são a evidência dos achados, não rascunho.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel) => readFileSync(path.join(repoRoot, rel), "utf8")

const RELATORIO = ".docs/RESEARCH/prd52-54-external-agent-methods-20260805.md"
const REGISTRY = ".docs/RESEARCH/repository-registry.json"
const PRD = { 52: ".docs/PLANS/prd52.md", 53: ".docs/PLANS/prd53.md", 54: ".docs/PLANS/prd54.md" }

const conta = (texto, termo) => (texto.match(new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length

/**
 * Markdown quebra frases em várias linhas, e blockquote intercala `>`. Casar
 * afirmação contra o texto cru falharia por formatação — não por ausência.
 */
const corrido = (texto) => texto.replace(/^\s*>\s?/gm, " ").replace(/\s+/g, " ")

// ── Documentos versionados ───────────────────────────────────────────────────

test("os CINCO artefatos dos achados estão versionados", () => {
  // Três PRDs + relatório comparativo + registry. Chamá-los de "quatro
  // documentos" era erro de contagem no próprio nome do teste.
  const artefatos = [RELATORIO, REGISTRY, ...Object.values(PRD)]
  assert.equal(artefatos.length, 5)
  for (const rel of artefatos) {
    assert.ok(existsSync(path.join(repoRoot, rel)), `${rel} precisa existir no repositório`)
    assert.ok(ler(rel).length > 500, `${rel} não pode ser um stub`)
  }
})

test("o relatório declara o gate do registry e o batch obrigatório", () => {
  const t = corrido(ler(RELATORIO))
  assert.match(t, /repository-registry\.json/, "cita o registry, conforme o CLAUDE.md do projeto")
  assert.match(t, /batch-6-aidd-methodology/,
    "o batch AIDD é OBRIGATÓRIO quando o tema é metodologia/skills/onboarding/cross-harness")
  assert.match(t, /nunca vira depend[êe]ncia\s+runtime/i,
    "referência metodológica não pode virar dependência do produto")
})

// ── OWNERSHIP por SEÇÃO ──────────────────────────────────────────────────────

const documentos = () => ({ 52: ler(PRD[52]), 53: ler(PRD[53]), 54: ler(PRD[54]) })

test("a matriz de contratos cobre os três PRDs e todos os contratos aprovados", () => {
  const porDono = {}
  for (const c of MATRIZ_CONTRATOS) (porDono[c.dono] ??= []).push(c.termo)
  for (const p of [52, 53, 54]) {
    assert.ok((porDono[p] ?? []).length >= 4, `PRD${p} precisa ter ao menos 4 contratos cobertos`)
  }

  // Contratos aprovados no relatório comparativo que a primeira versão omitia.
  const cobertos = new Set(MATRIZ_CONTRATOS.map((c) => c.termo))
  for (const obrigatorio of [
    "sourceClass", "evidenceKind", "invocationAuthority", "Agent Experience (AX)",
    "protótipo", "contextPressure", "effectState", "operatorRunbookRef",
    "multiplicidade", "uninstall",
  ]) {
    assert.ok(cobertos.has(obrigatorio), `contrato aprovado sem cobertura: \`${obrigatorio}\``)
  }
})

test("TODOS os contratos estão na seção dona, sem vazamento e com concentração", () => {
  const problemas = verificarOwnership(documentos(), MATRIZ_CONTRATOS)
  assert.deepEqual(problemas, [],
    `ownership violado:\n${problemas.map((p) => `  ${p.tipo}: ${p.termo} (PRD${p.dono})`).join("\n")}`)
})

/**
 * CONTROLE NEGATIVO REAL — o anterior era vazio.
 *
 * A versão anterior removia o termo e apenas confirmava que a remoção ocorrera;
 * NUNCA executava a validação. Se o verificador parasse de reprovar, o controle
 * seguiria verde — um teste que testava a si mesmo. Aqui o documento mutilado é
 * passado ao MESMO `verificarOwnership` do teste principal, e ele precisa
 * devolver o problema.
 */
test("CONTROLE: mover contrato para outra seção do MESMO PRD é reprovado", () => {
  const docs = documentos()
  const mapa = secoesDe(docs[53])
  const s = secaoPorPrefixo(mapa, "8.3.1")
  assert.ok(s && contar(s.corpo, "reference_pack") >= 1, "pré-condição: o termo está na seção dona")

  // Move o termo para FORA da seção dona mantendo-o no documento: a contagem
  // TOTAL do arquivo não muda, e só a checagem por seção pega a diferença.
  const antes = contar(docs[53], "reference_pack")
  const removidos = contar(s.corpo, "reference_pack")
  const corpoSemTermo = s.corpo.replace(/reference_pack/gi, "termo_deslocado")
  const mutilado = `${docs[53].replace(s.corpo, corpoSemTermo)}\n\n## 99. Apêndice\n\n${"reference_pack ".repeat(removidos)}\n`

  assert.equal(contar(mutilado, "reference_pack"), antes,
    "a contagem total precisa ficar IDÊNTICA — é isso que torna a checagem por arquivo cega ao deslocamento")

  const problemas = verificarOwnership({ ...docs, 53: mutilado }, MATRIZ_CONTRATOS)
  const achado = problemas.find((p) => p.termo === "reference_pack" && p.tipo === "secao_ausente")
  assert.ok(achado, `o verificador precisa reprovar; devolveu: ${JSON.stringify(problemas)}`)
  assert.equal(achado.dono, 53)
  assert.equal(achado.secao, "8.3.1")
})

test("CONTROLE: contrato vazando para outro PRD é reprovado", () => {
  const docs = documentos()
  // Injeta `SkillBinding` (do PRD53) dez vezes no PRD54.
  const mutilado = `${docs[54]}\n\n## 98. Invasão\n\n${"SkillBinding ".repeat(10)}\n`

  const problemas = verificarOwnership({ ...docs, 54: mutilado }, MATRIZ_CONTRATOS)
  const vazou = problemas.find((p) => p.termo === "SkillBinding" && p.tipo === "vazamento")
  assert.ok(vazou, "o verificador precisa detectar o vazamento")
  assert.equal(vazou.outro, "54")
  assert.ok(vazou.n > vazou.teto)
})

/**
 * O regime `compartilhadoCom` é a saída óbvia para fazer qualquer contrato
 * inconveniente passar. Estes três testes fecham a porta: ele é minoritário,
 * exige a seção âncora como o exclusivo, e IMPÕE obrigações que o exclusivo não
 * tem — quem compartilha precisa usar, e quem não foi declarado não pode usar.
 */
test("compartilhamento é exceção medida, não regime padrão", () => {
  const compartilhados = MATRIZ_CONTRATOS.filter((c) => c.compartilhadoCom)
  assert.ok(compartilhados.length >= 1, "há ao menos um — senão os controles abaixo não valem")
  assert.ok(compartilhados.length * 4 <= MATRIZ_CONTRATOS.length,
    `${compartilhados.length}/${MATRIZ_CONTRATOS.length} compartilhados: virou escape hatch, não exceção`)
  for (const c of compartilhados) {
    assert.ok(c.secao, `\`${c.termo}\` compartilhado ainda precisa declarar a seção âncora do dono`)
    assert.equal(c.maxOutros, undefined, "`maxOutros` não se aplica ao regime compartilhado — deixá-lo confunde os dois")
  }
})

test("CONTROLE: compartilhador declarado que ABANDONA o termo é reprovado", () => {
  const docs = documentos()
  const semTermo = docs[54].replace(/sourceClass/gi, "campo_removido")
  const problemas = verificarOwnership({ ...docs, 54: semTermo }, MATRIZ_CONTRATOS)
  const achado = problemas.find((p) => p.termo === "sourceClass" && p.tipo === "compartilhador_ausente")
  assert.ok(achado, "vocabulário transversal que some de um dos documentos deixou de ser transversal")
  assert.equal(achado.outro, "54")
})

test("CONTROLE: uso por PRD fora da lista declarada é reprovado", () => {
  const docs = documentos()
  const restrito = MATRIZ_CONTRATOS.map((c) =>
    c.termo === "sourceClass" ? { ...c, compartilhadoCom: [54] } : c)
  const problemas = verificarOwnership(docs, restrito)
  const achado = problemas.find((p) => p.termo === "sourceClass" && p.tipo === "compartilhamento_nao_declarado")
  assert.ok(achado, "PRD52 usa o termo sem estar declarado — precisa reprovar")
  assert.equal(achado.outro, "52")
})

/**
 * CONCENTRAÇÃO — a regra que sobreviveu ao primeiro round de mutação.
 *
 * Desligar `sem_concentracao` no verificador não fazia teste algum falhar: os
 * controles existentes eram todos casos em que `vazamento` disparava junto e
 * mascarava a ausência. Documentos SINTÉTICOS resolvem isso — com teto folgado,
 * `vazamento` não dispara e só a concentração pode pegar o problema.
 */
const SINTETICO = (n52, n53, n54) => ({
  52: `## 9.9 Âncora\n\n${"conceito ".repeat(n52)}`,
  53: `## 9.9 Âncora\n\n${"conceito ".repeat(n53)}`,
  54: `## 9.9 Âncora\n\n${"conceito ".repeat(n54)}`,
})
const CONTRATO_SINTETICO = [{ termo: "conceito", dono: 53, secao: "9.9", maxOutros: 99 }]

test("CONTROLE: dono que perde a concentração é reprovado — mesmo sem vazamento", () => {
  // PRD52 concentra 9× contra 1× do dono; teto 99 impede que `vazamento` dispare.
  const problemas = verificarOwnership(SINTETICO(9, 1, 1), CONTRATO_SINTETICO)
  assert.deepEqual(problemas.map((p) => p.tipo), ["sem_concentracao"],
    "só a concentração pode acusar aqui; se vier vazamento junto, o caso deixou de isolar a regra")
  assert.equal(problemas[0].lider, "52")
  assert.equal(problemas[0].n, 9)
})

test("CONTROLE: empate NÃO conta como concentração do dono", () => {
  // Empate 5-5-5: ninguém concentra, e o dono não pode herdar a dúvida.
  const problemas = verificarOwnership(SINTETICO(5, 5, 5), CONTRATO_SINTETICO)
  assert.equal(problemas.length, 1, "empate precisa reprovar — ownership por maioria simples não existe")
  assert.equal(problemas[0].tipo, "sem_concentracao")
})

test("CONTROLE: dono que concentra é aprovado — a regra não reprova sempre", () => {
  assert.deepEqual(verificarOwnership(SINTETICO(1, 9, 1), CONTRATO_SINTETICO), [])
})

test("CONTROLE: seção dona inexistente é reprovada, não ignorada", () => {
  const docs = documentos()
  const problemas = verificarOwnership(docs, [
    { termo: "reference_pack", dono: 53, secao: "99.9 Seção que não existe", maxOutros: 0 },
  ])
  assert.ok(problemas.some((p) => p.tipo === "secao_inexistente"),
    "seção ausente precisa reprovar — silenciar seria aprovar por omissão")
})

test("CONTROLE: verificador aprova documentos íntegros — não reprova por construção", () => {
  assert.deepEqual(verificarOwnership(documentos(), MATRIZ_CONTRATOS), [],
    "se reprovasse sempre, os controles negativos não provariam nada")
})

// ── Registry: fontes citadas existem, com disposição declarada ───────────────

const registro = () => JSON.parse(ler(REGISTRY))

test("o registry mantém o schema e as quatro fontes auditadas nos achados", () => {
  const r = registro()
  assert.equal(r.schemaVersion, 1)

  const porUrl = new Map(r.externalReferences.map((e) => [e.url, e]))
  const CITADAS = [
    "https://github.com/mattpocock/skills",
    "https://www.aihero.dev/",
    "https://github.com/happyrobot-ai/livekit-agents",
    "https://github.com/livekit/agents",
  ]
  for (const url of CITADAS) {
    assert.ok(porUrl.has(url), `o relatório cita ${url} — precisa estar no registry`)
    const e = porUrl.get(url)
    assert.ok(e.status && e.role, `${url} sem status/role`)
    assert.ok(e.note && e.note.length > 40, `${url} sem nota de disposição utilizável`)
  }
})

/**
 * O fork HappyRobot foi comparado ao upstream e não traz alteração exclusiva.
 * Ele permanece `archived_reference` DE PROPÓSITO: decisões atuais citam
 * `livekit/agents`. Promovê-lo a `active` faria contexto histórico voltar a
 * fundamentar decisão viva.
 */
test("HappyRobot permanece histórico; o upstream é que é referência viva", () => {
  const r = registro()
  const porUrl = new Map(r.externalReferences.map((e) => [e.url, e]))

  const fork = porUrl.get("https://github.com/happyrobot-ai/livekit-agents")
  assert.equal(fork.status, "archived_reference", "o fork não pode voltar a ser referência ativa")

  const upstream = porUrl.get("https://github.com/livekit/agents")
  assert.equal(upstream.status, "active_reference", "o upstream é a referência viva de lifecycle/testes")

  const t = corrido(ler(RELATORIO))
  assert.match(t, /fork permanece apenas como contexto hist[óo]rico/i,
    "o relatório precisa declarar que o fork é histórico")
})

test("toda entrada `archived_reference` é tratada como contexto, nunca como decisão", () => {
  const r = registro()
  const arquivadas = r.externalReferences.filter((e) => e.status === "archived_reference")
  assert.ok(arquivadas.length > 0, "há entradas arquivadas — o teste precisa delas para valer")

  // A tabela de decisões do relatório atribui destino a cada ideia. Nenhuma linha
  // de decisão pode ter um repo arquivado como ORIGEM.
  const t = ler(RELATORIO)
  const decisoes = t.split("\n").filter((l) => /\|\s*(adotar|adaptar|rejeitar|candidate|corroborar)\s*\|/.test(l))
  assert.ok(decisoes.length > 8, `esperado volume real de decisões, veio ${decisoes.length}`)
  for (const a of arquivadas) {
    const nome = a.url.split("/").pop()
    for (const linha of decisoes) {
      assert.ok(!linha.includes(nome),
        `decisão atual cita repo arquivado (${nome}): ${linha.slice(0, 80)}`)
    }
  }
})

// ── Invariantes que o relatório declara ──────────────────────────────────────

test("o relatório declara as invariantes de não-contaminação", () => {
  const t = corrido(ler(RELATORIO))
  const INVARIANTES = [
    /Nenhuma refer[êe]ncia externa virou depend[êe]ncia runtime/i,
    /Nenhuma config global foi alterada/i,
    /candidate\/shadow at[ée] prova interna/i,
    /somente contexto hist[óo]rico/i,
    /n[ãa]o ampliam o PRD51/i,
  ]
  for (const re of INVARIANTES) assert.match(t, re, `invariante ausente: ${re}`)
})

test("instalar repositório externo é explicitamente REJEITADO", () => {
  const t = ler(RELATORIO)
  const linha = t.split("\n").find((l) => /instalar skills\/reposit[óo]rios externos/i.test(l))
  assert.ok(linha, "a decisão sobre instalar repos externos precisa estar na tabela")
  assert.match(linha, /rejeitar/, "instalar fonte externa viola ownership e independência de runtime")
})
