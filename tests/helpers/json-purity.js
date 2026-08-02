/**
 * Validador de pureza do contrato `--json`. HELPER DE TESTE.
 *
 * Vive em `tests/helpers/` de proposito: nao tem consumidor em runtime. A
 * primeira versao foi colocada em `src/meta/` e isso estava errado — publicar
 * superficie de producao apenas para testar o produto aumenta o que precisa ser
 * mantido, versionado e auditado sem que nada em producao a use. Se algum dia
 * `verify` ou outro gate passar a validar pureza, ai sim ela se muda para `src/`
 * com consumidor real.
 *
 * POR QUE ELE EXISTE. A varredura do DOD.13 usava `lastJsonLine`: procura a
 * ULTIMA linha de stdout que parseia como JSON. Isso aceita banner humano,
 * progresso e ANSI desde que exista uma linha JSON no fim — prova "existe JSON
 * na saida", nao "a saida E JSON". Um consumidor fazendo `JSON.parse(stdout)`
 * inteiro quebra mesmo com aquele teste verde.
 *
 * Tambem e o SEAM do controle negativo: saida suja entra como FIXTURE, sem
 * precisar sujar um comando de producao temporariamente.
 */
export const JSON_PURITY_SCHEMA = "gstack.json-purity.v1"

/**
 * Sequencia ANSI REAL — exige o caractere ESC (U+001B).
 *
 * A 1a versao casava colchete+digitos+letra SEM exigir ESC, e portanto reprovava
 * `{"text":"[31m"}` — JSON perfeitamente valido cujo CONTEUDO apenas se parece
 * com codigo de cor. Um validador que rejeita entrada legitima e pior que
 * nenhum: ensina a ignora-lo. Ha controle negativo fixando exatamente esse caso.
 */
const ANSI = /\[[0-9;]*[A-Za-z]/

const impuro = (reason) => ({ pure: false, reason, doc: null })
const parseavel = (l) => { try { JSON.parse(l); return true } catch { return false } }

/**
 * Distingue as formas de sujeira — a correcao difere em cada uma: banner pede
 * suprimir render humano; dois documentos pedem modo ndjson declarado; nada
 * parseavel costuma ser o comando ignorando a flag.
 */
function classifyDirt(trimmed) {
  const parseaveis = trimmed.split("\n").filter((l) => l.trim()).filter(parseavel)
  if (parseaveis.length > 1) return impuro("multiple_json_documents")
  return impuro(parseaveis.length === 1 ? "human_text_around_json" : "not_json_at_all")
}

const documentoValido = (doc) => doc !== null && typeof doc === "object"

/** `stdout` e UM documento JSON puro? Motivo NOMEADO, nunca booleano solo. */
export function pureJsonStdout(stdout) {
  if (typeof stdout !== "string") return impuro("stdout_not_string")
  if (ANSI.test(stdout)) return impuro("ansi_escape_in_stdout")

  const trimmed = stdout.trim()
  if (trimmed === "") return impuro("empty_stdout")

  let doc
  try {
    doc = JSON.parse(trimmed)
  } catch {
    return classifyDirt(trimmed)
  }
  // Escalar (`3`, `"x"`, `true`) parseia mas nao e documento de contrato.
  return documentoValido(doc) ? { pure: true, reason: null, doc } : impuro("not_an_object_document")
}

/**
 * Politica de stderr sob `--json`:
 *
 *   stdout — EXATAMENTE um documento JSON.
 *   stderr — livre para DIAGNOSTICO humano; vazio e valido; NUNCA carrega o
 *            payload de maquina.
 *
 * A verificacao aqui e a que faltava na 1a versao: la `stderrPolicyOk` era
 * `allowed || vazio`, com `allowed` sempre `true` — sempre verdadeiro, logo
 * incapaz de reprovar. Um campo que parece verificacao e e constante e pior que
 * nenhum campo, porque produz confianca sem cobertura.
 *
 * ESCOPO DECLARADO NO NOME. Detecta documento JSON AUTONOMO: stderr inteiro que
 * parseia, ou uma LINHA inteira que parseia. NAO faz varredura estrutural de
 * JSON multilinha embutido em prosa — isso e problema de parser, com risco real
 * de falso positivo. O nome anterior (`stderrCarriesPayload`) prometia deteccao
 * geral que a implementacao nao entrega; renomeado para que a claim caiba no
 * que o codigo faz.
 */
export function stderrHasStandaloneJsonDocument(stderr) {
  if (typeof stderr !== "string" || stderr.trim() === "") return false
  const trimmed = stderr.trim()
  // Documento inteiro em stderr.
  try {
    if (documentoValido(JSON.parse(trimmed))) return true
  } catch { /* segue para a checagem por linha */ }
  // Ou uma LINHA inteira que seja documento JSON.
  return trimmed.split("\n").some((l) => {
    const t = l.trim()
    if (!t.startsWith("{") && !t.startsWith("[")) return false
    try { return documentoValido(JSON.parse(t)) } catch { return false }
  })
}

/**
 * Avalia uma execucao completa (resultado de `spawnSync`).
 *
 * `exitCode` e REGISTRADO, nao asserido: o produto e inconsistente (alguns
 * caminhos de erro saem 0 com `{"error":...}`, outros chamam `process.exit(1)`),
 * e fixar politica aqui inventaria contrato ainda nao decidido — fica como
 * achado P1 separado.
 *
 * Falha de spawn, sinal e timeout REPROVAM: um teste que nao distingue "comando
 * cumpriu o contrato" de "comando nem rodou" mede a propria harness.
 */
export function evaluateJsonRun({ stdout = "", stderr = "", status = null, signal = null, error = null } = {}) {
  const p = pureJsonStdout(stdout)
  const timedOut = Boolean(error && /ETIMEDOUT|timed? ?out/i.test(String(error.code || error.message || "")))
  return {
    schemaVersion: JSON_PURITY_SCHEMA,
    pure: p.pure,
    reason: p.reason,
    doc: p.doc,
    exitCode: status,
    signal,
    spawnFailed: Boolean(error) && !timedOut,
    timedOut,
    ran: !error && signal === null,
    stderrBytes: stderr.length,
    stderrHasStandaloneJson: stderrHasStandaloneJsonDocument(stderr),
  }
}
