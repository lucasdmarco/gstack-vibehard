/**
 * DiagnosticLogger — contrato canônico do canal de diagnóstico.
 *
 * A distinção que este módulo formaliza: **audiência pertence à mensagem;
 * injeção troca o transporte**. Um teste que captura `logger.warn()` não
 * transforma a frase em protocolo de máquina — ela continua sendo texto que uma
 * pessoa lê, apenas escrito noutro lugar.
 *
 * Sem esse contrato, a análise estática ficava presa num falso dilema: ou
 * afirmava que todo `logger.warn` de `create.js` é canônico (falso, porque
 * `createProject({ logger })` é exportada e a suíte injeta), ou não afirmava
 * nada (inútil, porque o caminho real do CLI usa o logger padrão). Com o
 * normalizador, **todas as rotas — a default e as injetadas — atravessam o mesmo
 * objeto de origem conhecida**, e a origem deixa de depender de quem chamou.
 *
 * Vive em módulo próprio, sem dependências, para que `cli/index.js` e
 * `cli/create.js` possam usá-lo sem criar ciclo de importação entre eles.
 */

/** Os quatro métodos do canal. Ordem fixa: é o contrato, não uma sugestão. */
export const DIAGNOSTIC_METHODS = Object.freeze(["info", "success", "warn", "error"])

/** Erro tipado — rejeição CEDO, no ponto de entrada, nunca no meio do fluxo. */
export class InvalidDiagnosticLoggerError extends TypeError {
  constructor(motivo, detalhe = {}) {
    super(`logger de diagnóstico inválido: ${motivo}`)
    this.name = "InvalidDiagnosticLoggerError"
    this.code = "INVALID_DIAGNOSTIC_LOGGER"
    this.detail = detalhe
  }
}

/**
 * Marca de normalização.
 *
 * `Symbol` e não campo comum: um objeto qualquer não passa a ser logger
 * canônico por declarar `{ __diagnostic: true }`. A marca só é aposta aqui.
 */
const DIAGNOSTIC_LOGGER = Symbol.for("gstack.diagnostic-logger.v1")

/** O objeto passou por `normalizeDiagnosticLogger`? */
export const isDiagnosticLogger = (v) => Boolean(v) && v[DIAGNOSTIC_LOGGER] === true

const ehObjeto = (v) => Boolean(v) && (typeof v === "object" || typeof v === "function")

/**
 * Normaliza qualquer sink válido no contrato canônico.
 *
 * O wrapper encaminha **exatamente** a mensagem ao método correspondente: não
 * acrescenta texto, não serializa, não reordena e não muda a audiência. Ele é a
 * identidade sobre o conteúdo — só fixa a forma.
 *
 * `this` do sink é preservado (`Reflect.apply` com o objeto original), porque um
 * logger de classe pode depender de estado interno, e arrancar o receptor
 * quebraria implementações legítimas por um detalhe de fiação.
 *
 * O resultado é congelado: quem recebe o logger normalizado não pode trocar um
 * método depois e mudar para onde a mensagem vai.
 */
export function normalizeDiagnosticLogger(sink) {
  if (!ehObjeto(sink)) {
    throw new InvalidDiagnosticLoggerError("não é um objeto", { received: typeof sink })
  }

  const faltando = DIAGNOSTIC_METHODS.filter((m) => typeof sink[m] !== "function")
  if (faltando.length > 0) {
    // Logger PARCIAL é rejeitado aqui, e não quando alguém chamar o método
    // ausente no meio de uma operação — falhar tarde esconderia a causa.
    throw new InvalidDiagnosticLoggerError("métodos ausentes ou não-função", { missing: faltando })
  }

  // Já normalizado: devolver o mesmo objeto evita camadas de wrapper a cada
  // repasse, e mantém a identidade estável para quem compara referências.
  if (isDiagnosticLogger(sink)) return sink

  const wrapper = {}
  for (const metodo of DIAGNOSTIC_METHODS) {
    wrapper[metodo] = (mensagem) => Reflect.apply(sink[metodo], sink, [mensagem])
  }
  Object.defineProperty(wrapper, DIAGNOSTIC_LOGGER, { value: true, enumerable: false })
  return Object.freeze(wrapper)
}
