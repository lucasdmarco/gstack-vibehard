/**
 * PRD52 S52.B — os DENTES do contrato de claim.
 *
 * O que este arquivo tem de provar não é que a régua existe, e sim que ela
 * REPROVA. Cada regra ganha um controle negativo com fixture sintética: um
 * contrato adulterado só naquele campo, tudo o mais válido. Fixture sintética
 * porque o repo real (de propósito) só exercita o caminho feliz — se os testes
 * dependessem dos contratos reais, a régua ficaria provada apenas onde já passa.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// Um leitor SINTÉTICO: o universo de arquivos é exatamente o que o teste declara.
function leitorFalso(arquivos) {
  return {
    has: (rel) => Object.prototype.hasOwnProperty.call(arquivos, rel),
    read: (rel) => arquivos[rel] ?? "",
  }
}

const MUNDO = {
  "src/skills/coisa.js": "export function coisa() { return 1 }",
  "src/commands/roda-coisa.js": 'import { coisa } from "../skills/coisa.js"\nexport const x = coisa',
  "src/index.js": "// cli",
  "tests/coisa.test.js": 'const mod = path.resolve(d, "..", "src", "skills", "coisa.js")',
  "tests/indireto.test.js": 'const mod = path.resolve(d, "..", "src", "commands", "roda-coisa.js")',
  "tests/alheio.test.js": 'const mod = path.resolve(d, "..", "src", "outro", "nada.js")',
}

const CONTRATO_BOM = Object.freeze({
  evidenceAdapter: "src/skills/coisa.js",
  e2eCommand: "node src/index.js coisa --json",
  negativeControl: "tests/coisa.test.js — some coisa some falha",
  freshness: "por-run",
})

test("contrato válido sobrevive à verificação executável", async () => {
  const { contratoComDentes, problemasDoContrato } = await imp("src/dream/claim-contract-check.js")
  const io = leitorFalso(MUNDO)
  assert.deepEqual(problemasDoContrato(CONTRATO_BOM, io), [], "o contrato de referência não pode ter problema")
  assert.equal(contratoComDentes(CONTRATO_BOM, io), true)
})

// ── Controles negativos: uma fixture por regra, cada uma reprovando por si ──
const CASOS_QUE_REPROVAM = [
  ["adapter_path", { evidenceAdapter: "src/skills/coisa.js (o módulo de coisa)" }, "prosa no campo de caminho"],
  ["adapter_path", { evidenceAdapter: "src/skills/inexistente.js" }, "adaptador que não existe"],
  ["e2e_executavel", { e2eCommand: "fazCoisa (via task/workflow)" }, "nome de função no lugar de comando"],
  ["e2e_arquivos", { e2eCommand: "node src/naoexiste.js coisa" }, "comando citando arquivo ausente"],
  ["controle_negativo_existe", { negativeControl: "o teste que reprova se sumir" }, "controle negativo sem teste citado"],
  ["controle_negativo_intacto", { negativeControl: "tests/coisa.test.js e tests/sumiu.test.js reprovam" }, "teste citado que não existe"],
  ["controle_negativo_liga", { negativeControl: "tests/alheio.test.js — reprova" }, "teste que nunca toca a capacidade"],
  ["frescor_fechado", { freshness: "quando der" }, "frescor fora do vocabulário fechado"],
]

for (const [regra, mutacao, descricao] of CASOS_QUE_REPROVAM) {
  test(`CONTROLE NEGATIVO [${regra}]: ${descricao} é reprovado`, async () => {
    const { contratoComDentes, problemasDoContrato } = await imp("src/dream/claim-contract-check.js")
    const io = leitorFalso(MUNDO)
    const ruim = { ...CONTRATO_BOM, ...mutacao }
    const p = problemasDoContrato(ruim, io)
    assert.equal(contratoComDentes(ruim, io), false, `${descricao} não pode passar`)
    assert.ok(p.some((x) => x.startsWith(`[${regra}]`)), `esperava a regra ${regra}, veio: ${JSON.stringify(p)}`)
  })
}

test("ligação vale pelo SALTO do caminho de chamada (teste roda quem importa o adaptador)", async () => {
  const { contratoComDentes } = await imp("src/dream/claim-contract-check.js")
  const io = leitorFalso(MUNDO)
  const indireto = { ...CONTRATO_BOM, negativeControl: "tests/indireto.test.js — reprova" }
  assert.equal(contratoComDentes(indireto, io), true, "roda-coisa.js importa coisa.js: a capacidade É exercitada")
})

test("ligação NÃO vale por semelhança de nome — só por arquivo", async () => {
  const { contratoComDentes } = await imp("src/dream/claim-contract-check.js")
  const io = leitorFalso({ ...MUNDO, "tests/fala.test.js": "// fala de coisa, coisa, coisa, mas não roda nada" })
  const falso = { ...CONTRATO_BOM, negativeControl: "tests/fala.test.js — reprova" }
  assert.equal(contratoComDentes(falso, io), false, "mencionar o nome não é exercitar")
})

test("gradeClaimStatus NÃO tem porta dos fundos: sem `io` a verificação continua valendo", async () => {
  const { gradeClaimStatus, NOT_PROVED } = await imp("src/dream/claim-contract.js")
  const inventado = {
    evidenceAdapter: "src/nao/existe.js", e2eCommand: "node src/nao/existe.js",
    negativeControl: "tests/nao_existe.test.js", freshness: "por-run",
  }
  assert.equal(gradeClaimStatus("REAL", inventado), NOT_PROVED, "contrato inventado nunca é REAL, com ou sem leitor")
  assert.equal(gradeClaimStatus("PARTIAL", null), "PARTIAL", "status não-REAL segue intocado")
})

// ── O placar real, e o registro da transição ──

test("o auditor real aplica os dentes e explica a queda", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const r = audit({ behavioral: true })
  const caidas = r.claims.filter((c) => c.notProved)
  for (const c of caidas) {
    assert.ok(Array.isArray(c.notProvedReasons) && c.notProvedReasons.length > 0,
      `'${c.id}' caiu sem motivo registrado — rebaixar em silêncio é o defeito que o S52.B corrige`)
  }
  assert.ok((r.summary.REAL || 0) + (r.summary.NOT_PROVED || 0) > 0, "o placar precisa existir")
})

test("baseline S52.B: a transição medida É a registrada (nenhuma queda entra em silêncio)", async () => {
  const { divergenciaDoBaseline } = await imp("src/dream/teeth-baseline.js")
  assert.deepEqual(divergenciaDoBaseline(), [],
    "contrato novo que não passa nos dentes precisa ser registrado com motivo, nunca absorvido")
})

test("baseline S52.B: toda queda tem motivo escrito, e o histórico não some quando a conta zera", async () => {
  const { TEETH_BASELINE } = await imp("src/dream/teeth-baseline.js")
  const abertas = Object.entries(TEETH_BASELINE.quedas)
  const fechadas = Object.entries(TEETH_BASELINE.resolvidas)
  // A régua PRECISA ter derrubado algo alguma vez, senão não tem dentes. O que
  // ela não precisa é continuar com a queda ABERTA: fechar por trabalho é o
  // desfecho desejado, e o registro fica em `resolvidas`.
  assert.ok(abertas.length + fechadas.length > 0, "uma régua que nunca derrubou nada não é régua")
  for (const [id, motivo] of abertas) assert.ok(motivo.length > 120, `'${id}': o motivo precisa explicar, não rotular`)
  for (const [id, r] of fechadas) {
    assert.ok(r.caiuPor.length > 120, `'${id}': por que caiu precisa explicar`)
    assert.ok(r.fechadaPor.length > 120, `'${id}': COMO foi fechada é a parte que impede afrouxamento disfarçado`)
    assert.ok(r.sprint, `'${id}': sem sprint não dá para achar o commit`)
  }
  assert.equal(TEETH_BASELINE.antes.comContrato - TEETH_BASELINE.depois.comDentes,
    abertas.length, "a aritmética antes/depois tem de fechar com as quedas ABERTAS")
})

test("a queda fechada NÃO reaparece: `action-kernel` volta a REAL por E2E real", async () => {
  const { audit } = await imp("src/dream/auditor.js")
  const { TEETH_BASELINE } = await imp("src/dream/teeth-baseline.js")
  assert.ok(TEETH_BASELINE.resolvidas["action-kernel"], "a resolução tem de estar registrada")
  const claim = audit({ behavioral: true }).claims.find((c) => c.id === "action-kernel")
  assert.equal(claim.status, "REAL", "com E2E executável e controle negativo ligado, a claim sustenta REAL")
  assert.ok(!claim.notProved)
})

test("CONTROLE NEGATIVO do baseline: queda não registrada é acusada", async () => {
  const { divergenciaDoBaseline } = await imp("src/dream/teeth-baseline.js")
  const comIntruso = {
    "claim-intruso": {
      evidenceAdapter: "src/nao/existe.js", e2eCommand: "node src/nao/existe.js",
      negativeControl: "tests/nao_existe.test.js", freshness: "por-run",
    },
  }
  const d = divergenciaDoBaseline(comIntruso)
  assert.ok(d.some((x) => x.includes("claim-intruso")), `esperava acusação do intruso, veio: ${JSON.stringify(d)}`)
})
