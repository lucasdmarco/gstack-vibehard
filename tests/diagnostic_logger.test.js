import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeDiagnosticLogger, isDiagnosticLogger, InvalidDiagnosticLoggerError, DIAGNOSTIC_METHODS,
} from "../src/cli/diagnostic-logger.js"

/**
 * Contrato do DiagnosticLogger.
 *
 * A decisão que ele formaliza: **audiência pertence à mensagem; injeção troca o
 * transporte**. Um teste que captura `logger.warn()` não transforma a frase em
 * protocolo de máquina, e por isso `createProject({ logger })` não precisa ser
 * removida nem ignorada pela análise — precisa atravessar o adapter.
 *
 * O que o wrapper NÃO pode fazer é justamente o que o tornaria uma mudança de
 * audiência: acrescentar texto, serializar, reordenar ou engolir a mensagem.
 */

const captor = () => {
  const vistos = []
  const sink = {}
  for (const m of DIAGNOSTIC_METHODS) sink[m] = (msg) => vistos.push([m, msg])
  return { sink, vistos }
}

// ── Encaminhamento exato ────────────────────────────────────────────────────

test("encaminha EXATAMENTE a mensagem ao método correspondente", () => {
  const { sink, vistos } = captor()
  const log = normalizeDiagnosticLogger(sink)

  for (const m of DIAGNOSTIC_METHODS) log[m](`mensagem de ${m}`)
  assert.deepEqual(vistos, DIAGNOSTIC_METHODS.map((m) => [m, `mensagem de ${m}`]),
    "nem texto acrescentado, nem método trocado, nem ordem alterada")
})

test("não serializa nem converte o argumento", () => {
  const { sink, vistos } = captor()
  const objeto = { a: 1 }
  normalizeDiagnosticLogger(sink).info(objeto)
  assert.equal(vistos[0][1], objeto, "o mesmo valor por referência — nada de JSON.stringify no caminho")
})

test("preserva o `this` do sink", () => {
  class Sink {
    constructor() { this.prefixo = "S"; this.vistos = [] }
    info(m) { this.vistos.push(`${this.prefixo}:${m}`) }
    success(m) { this.info(m) }
    warn(m) { this.info(m) }
    error(m) { this.info(m) }
  }
  const s = new Sink()
  normalizeDiagnosticLogger(s).info("oi")
  assert.deepEqual(s.vistos, ["S:oi"],
    "arrancar o receptor quebraria logger de classe por um detalhe de fiação")
})

// ── Rejeição CEDO, com erro tipado ──────────────────────────────────────────

test("logger PARCIAL é rejeitado na entrada, não no meio do fluxo", () => {
  const parcial = { info: () => {}, warn: () => {} } // faltam success e error
  assert.throws(() => normalizeDiagnosticLogger(parcial), (e) => {
    assert.ok(e instanceof InvalidDiagnosticLoggerError)
    assert.equal(e.code, "INVALID_DIAGNOSTIC_LOGGER")
    assert.deepEqual(e.detail.missing, ["success", "error"])
    return true
  }, "falhar tarde esconderia a causa atrás de uma operação já iniciada")
})

test("método que NÃO é função é rejeitado", () => {
  const falso = { info: "texto", success: () => {}, warn: () => {}, error: () => {} }
  assert.throws(() => normalizeDiagnosticLogger(falso), InvalidDiagnosticLoggerError)
})

test("valor não-objeto é rejeitado com o tipo recebido", () => {
  for (const v of [null, undefined, 42, "logger", true]) {
    assert.throws(() => normalizeDiagnosticLogger(v), (e) => {
      assert.equal(e.code, "INVALID_DIAGNOSTIC_LOGGER")
      return true
    }, `${String(v)} não pode passar`)
  }
})

// ── Identidade e imutabilidade ──────────────────────────────────────────────

test("o resultado é CONGELADO — ninguém troca o destino depois", () => {
  const { sink, vistos } = captor()
  const log = normalizeDiagnosticLogger(sink)
  assert.ok(Object.isFrozen(log))

  try { log.warn = () => vistos.push(["sequestrado", "x"]) } catch { /* strict mode */ }
  log.warn("mensagem")
  assert.deepEqual(vistos, [["warn", "mensagem"]], "a substituição não pode ter efeito")
})

test("normalizar duas vezes devolve o MESMO objeto", () => {
  const log = normalizeDiagnosticLogger(captor().sink)
  assert.equal(normalizeDiagnosticLogger(log), log,
    "repasse pela cadeia não pode empilhar wrappers nem trocar a identidade")
})

/**
 * A marca é a IDENTIDADE no `WeakSet`, não uma propriedade do objeto.
 *
 * A primeira versão usava `Symbol.for("gstack.diagnostic-logger.v1")`, que é
 * registro GLOBAL: qualquer código obtém a mesma chave e a escreve. Um objeto
 * com os quatro métodos vazios mais essa propriedade passava na validação e
 * escapava pelo curto-circuito de idempotência — sem wrapper, sem congelamento,
 * e reconhecido como canônico. Marca em propriedade é declaração; pertencer ao
 * conjunto é fato.
 */
test("objeto que se DECLARA canônico não engana `isDiagnosticLogger`", () => {
  const impostor = { info() {}, success() {}, warn() {}, error() {}, __diagnostic: true, isDiagnosticLogger: true }
  assert.equal(isDiagnosticLogger(impostor), false, "a marca só é aposta pelo normalizador")

  const real = normalizeDiagnosticLogger(impostor)
  assert.equal(isDiagnosticLogger(real), true)
  assert.notEqual(real, impostor, "o impostor foi ENVOLVIDO, não aceito como está")
})

test("BYPASS: forjar o `Symbol.for` exato NÃO produz logger canônico", () => {
  const forjado = {
    info() {}, success() {}, warn() {}, error() {},
    [Symbol.for("gstack.diagnostic-logger.v1")]: true,
  }
  assert.equal(isDiagnosticLogger(forjado), false, "o registro global de símbolos é acessível a qualquer código")

  const saida = normalizeDiagnosticLogger(forjado)
  assert.notEqual(saida, forjado, "não pode escapar pelo curto-circuito de idempotência")
  assert.ok(Object.isFrozen(saida), "o objeto forjado NÃO era congelado; o wrapper é")
  assert.equal(isDiagnosticLogger(saida), true)
})

test("BYPASS: CÓPIA de um wrapper legítimo não herda a canonicidade", () => {
  const real = normalizeDiagnosticLogger(captor().sink)

  // Copia tudo: propriedades enumeráveis, não-enumeráveis e símbolos.
  const clone = Object.create(Object.getPrototypeOf(real))
  for (const chave of Reflect.ownKeys(real)) {
    Object.defineProperty(clone, chave, Object.getOwnPropertyDescriptor(real, chave))
  }
  assert.deepEqual(Reflect.ownKeys(clone), Reflect.ownKeys(real), "a cópia tem as mesmas chaves")
  assert.equal(isDiagnosticLogger(clone), false,
    "mesmas chaves, outra identidade — o conjunto guarda o objeto, não o formato")
})

test("BYPASS: round-trip por JSON perde a canonicidade", () => {
  const real = normalizeDiagnosticLogger(captor().sink)
  const viaJson = { ...JSON.parse(JSON.stringify(real)), info() {}, success() {}, warn() {}, error() {} }
  assert.equal(isDiagnosticLogger(viaJson), false, "serializar e reconstruir cria outro objeto")
})

test("apenas a identidade DEVOLVIDA pelo normalizador pertence ao conjunto", () => {
  const { sink } = captor()
  const real = normalizeDiagnosticLogger(sink)

  assert.equal(isDiagnosticLogger(sink), false, "o sink de origem não é o logger canônico")
  assert.equal(isDiagnosticLogger(real), true)
  assert.equal(isDiagnosticLogger({ ...real }), false, "spread produz outro objeto")
  for (const v of [null, undefined, 0, "", "logger", true, Symbol("x")]) {
    assert.equal(isDiagnosticLogger(v), false, `${String(v)} não pode pertencer ao conjunto`)
  }
})

test("idempotência vale na INSTÂNCIA canônica deste módulo", () => {
  const real = normalizeDiagnosticLogger(captor().sink)
  assert.equal(normalizeDiagnosticLogger(real), real, "repasse não empilha wrapper")
  assert.equal(normalizeDiagnosticLogger(normalizeDiagnosticLogger(real)), real,
    "estável sob repetição — o conjunto reconhece a identidade, não um campo copiável")
})

// ── Compatibilidade: as duas rotas viram o mesmo contrato ───────────────────

/**
 * O ponto da decisão arquitetural: `defaultLogger` e um logger injetado por
 * teste têm implementações diferentes e a MESMA audiência. Depois do adapter,
 * ambos são o canal de diagnóstico — o que muda é para onde os bytes vão.
 */
test("rota default e rota injetada produzem o mesmo contrato", () => {
  const escritos = []
  const defaultLike = {
    info: (m) => escritos.push(`out:${m}`),
    success: (m) => escritos.push(`out:${m}`),
    warn: (m) => escritos.push(`out:${m}`),
    error: (m) => escritos.push(`err:${m}`),
  }
  const injetado = captor()

  const a = normalizeDiagnosticLogger(defaultLike)
  const b = normalizeDiagnosticLogger(injetado.sink)

  for (const log of [a, b]) assert.ok(isDiagnosticLogger(log) && Object.isFrozen(log))
  assert.deepEqual(DIAGNOSTIC_METHODS.filter((m) => typeof a[m] !== "function"), [])
  assert.deepEqual(DIAGNOSTIC_METHODS.filter((m) => typeof b[m] !== "function"), [])

  a.warn("mesma frase")
  b.warn("mesma frase")
  assert.deepEqual(escritos, ["out:mesma frase"])
  assert.deepEqual(injetado.vistos, [["warn", "mesma frase"]],
    "a frase é idêntica nas duas rotas; só o transporte difere")
})

test("o contrato tem exatamente os quatro métodos, e a ordem é fixa", () => {
  assert.deepEqual([...DIAGNOSTIC_METHODS], ["info", "success", "warn", "error"])
  assert.ok(Object.isFrozen(DIAGNOSTIC_METHODS))
})
