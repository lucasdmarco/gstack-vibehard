import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

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

test("os quatro documentos dos achados estão versionados", () => {
  for (const rel of [RELATORIO, REGISTRY, ...Object.values(PRD)]) {
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

// ── OWNERSHIP: cada conceito no PRD dono ─────────────────────────────────────

/**
 * A tabela abaixo veio da CONTAGEM real nos três documentos, não de suposição.
 * `min` é quanto o dono precisa ter; `maxOutros` é o teto nos demais — margem
 * pequena existe porque uma referência cruzada é legítima, mas concentração é o
 * que define propriedade.
 */
const OWNERSHIP = [
  // PRD52 — prova e certificação
  { termo: "Claim Contract", dono: 52, min: 3, maxOutros: 2 },
  // PRD53 — governança de referências, autoridade de skills, avaliação
  { termo: "SkillBinding", dono: 53, min: 2, maxOutros: 0 },
  { termo: "Scenario Lab", dono: 53, min: 10, maxOutros: 0 },
  { termo: "reference_pack", dono: 53, min: 2, maxOutros: 0 },
  // PRD54 — Task Graph, lifecycle, handoff, PendingRequirement
  { termo: "Task Graph", dono: 54, min: 10, maxOutros: 1 },
  { termo: "PendingRequirement", dono: 54, min: 5, maxOutros: 1 },
  { termo: "failureScope", dono: 54, min: 2, maxOutros: 0 },
  { termo: "drain", dono: 54, min: 3, maxOutros: 0 },
]

test("cada conceito vive no PRD DONO — presença em outro não é propriedade", () => {
  const textos = { 52: ler(PRD[52]), 53: ler(PRD[53]), 54: ler(PRD[54]) }

  for (const { termo, dono, min, maxOutros } of OWNERSHIP) {
    const noDono = conta(textos[dono], termo)
    assert.ok(noDono >= min,
      `\`${termo}\` deveria ser desenvolvido no PRD${dono} (${noDono} ocorrência(s), mínimo ${min})`)

    for (const outro of [52, 53, 54].filter((p) => p !== dono)) {
      const n = conta(textos[outro], termo)
      assert.ok(n <= maxOutros,
        `\`${termo}\` pertence ao PRD${dono}, mas aparece ${n}x no PRD${outro} (teto ${maxOutros}) — o dono estaria decidindo sobre território alheio`)
    }
  }
})

test("os três territórios são distintos — nenhum PRD acumula os conceitos dos outros", () => {
  const textos = { 52: ler(PRD[52]), 53: ler(PRD[53]), 54: ler(PRD[54]) }
  const donos = {}
  for (const { termo, dono } of OWNERSHIP) (donos[dono] ??= []).push(termo)

  // Cada PRD precisa ser dono de pelo menos um conceito: se um deles ficasse sem
  // nenhum, a divisão de responsabilidade teria colapsado.
  for (const p of [52, 53, 54]) {
    assert.ok((donos[p] ?? []).length > 0, `PRD${p} precisa ser dono de ao menos um conceito`)
  }

  // E o dono precisa concentrar mais que qualquer outro.
  for (const { termo, dono } of OWNERSHIP) {
    const contagens = [52, 53, 54].map((p) => ({ p, n: conta(textos[p], termo) }))
    const lider = contagens.reduce((a, b) => (b.n > a.n ? b : a))
    assert.equal(lider.p, dono, `\`${termo}\`: quem concentra é o PRD${lider.p}, não o dono declarado PRD${dono}`)
  }
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
