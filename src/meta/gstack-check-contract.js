/**
 * CONTRATO `quality_gate.gstack_check` — o consumidor de `gc.py`, executável.
 *
 * `gc.py` não é registrado em evento de harness, e conectá-lo a
 * PreToolUse/PostToolUse/Stop só para zerar o inventário seria inventar
 * comportamento. O consumidor dele é REAL e já existia, só não tinha forma
 * verificável: a chave `quality_gate.gstack_check` que o produto ESCREVE em
 * `.gstack/config.json` de todo projeto que ele cria.
 *
 * Este módulo transforma esse wiring em contrato: quem o produz, como o caminho
 * se resolve, e o que a saída precisa ser para valer como protocolo. Sem isso, a
 * afirmação "alguém consome o stdout do `gc.py`" seria uma declaração sem
 * lastro — exatamente o que `machineProtocolAudit` existe para impedir.
 *
 * ZERO dependência de máquina: nada aqui lê `HOME` real, config real ou
 * instalação real. `home` e `packageRoot` são sempre parâmetros.
 */

import { existsSync } from "fs"
import { join, isAbsolute, basename, resolve, relative } from "path"

export const GSTACK_CHECK_SCHEMA = "gstack.quality-gate.gstack-check.v1"

/**
 * PRODUTORES do contrato, ancorados no fonte real.
 *
 * Declarados e versionados pelo mesmo motivo de `PYTHON_RUNTIME_ROOTS` e
 * `TEMPLATE_ROOTS`: que a chave seja escrita é fato do PRODUTO, não algo
 * derivável de um grep. Se um produtor deixar de escrevê-la, o contrato perdeu
 * uma origem e alguém precisa decidir o que isso significa.
 */
export const PRODUTORES_DO_CONTRATO = Object.freeze([
  Object.freeze({
    file: "src/commands/init.js",
    key: "quality_gate.gstack_check",
    evidence: "src/commands/init.js:134 — `quality_gate: { …, gstack_check: \"~/.gstack/hooks/gc.py\", …, fallback_gstack_check: \"~/.codex/hooks/gc.py\" }`, escrito em `.gstack/config.json`",
  }),
  Object.freeze({
    file: "scripts/scripts/setup-gstack.sh",
    key: "quality_gate.gstack_check",
    evidence: "scripts/scripts/setup-gstack.sh:26 — heredoc que grava `\"gstack_check\": \"$HOME/.codex/hooks/gc.py\"`",
  }),
  Object.freeze({
    file: "scripts/scripts/setup-gstack.ps1",
    key: "quality_gate.gstack_check",
    evidence: "scripts/scripts/setup-gstack.ps1:81 — `gstack_check = \"$env:USERPROFILE\\.codex\\hooks\\gc.py\"`",
  }),
])

/** O arquivo que o contrato pode apontar. Nome fixo: o pacote distribui UM. */
export const ARQUIVO_DO_CONTRATO = "gc.py"
/** Onde o pacote guarda o original que o instalador copia. */
export const ORIGEM_NO_PACOTE = join("hooks", "hooks", ARQUIVO_DO_CONTRATO)

const CHAVES = Object.freeze(["gstack_check", "fallback_gstack_check"])

/**
 * Expande `~`, `$HOME` e `%USERPROFILE%` — as três formas que os três produtores
 * usam. Nenhuma outra: um caminho que precise de expansão desconhecida não é
 * resolvível, e fingir que é seria pior do que recusar.
 */
export function expandirHome(caminho, home) {
  const s = String(caminho ?? "")
  if (s.startsWith("~/") || s.startsWith("~\\")) return join(home, s.slice(2))
  return s
    .replace(/^\$HOME/, home)
    .replace(/^%USERPROFILE%/, home)
    .replace(/^\$env:USERPROFILE/, home)
}

/**
 * O caminho declarado aponta para o arquivo que o pacote distribui?
 *
 * Porta contra config adulterada: o contrato autoriza executar UM arquivo
 * conhecido, e não "o que estiver escrito ali". Um `gstack_check` apontando para
 * `/tmp/qualquer.py` é config hostil, e executá-la seria transformar um arquivo
 * de projeto em vetor de execução.
 */
export const ehArquivoDoContrato = (caminho) => basename(String(caminho ?? "")) === ARQUIVO_DO_CONTRATO

/**
 * Resolve o consumidor a partir da configuração PUBLICADA.
 *
 * A ordem é a do próprio produtor: `gstack_check`, depois
 * `fallback_gstack_check`. `packageRoot` fecha a cadeia quando nenhuma
 * instalação existe — é a MESMA origem que o instalador copia, e por isso não é
 * atalho: sem ela, o contrato só seria verificável em máquina com install feito,
 * e uma prova que depende do ambiente do desenvolvedor não prova o produto.
 */
const recusa = (reason, path = null, source = null) => ({ ok: false, reason, path, source })
const aceita = (path, source) => ({ ok: true, reason: null, path, source })

/** Primeira chave declarada que resolve para arquivo existente, ou a recusa. */
function porChaveDeclarada(qg, declaradas, home) {
  for (const chave of declaradas) {
    const bruto = qg[chave]
    if (!ehArquivoDoContrato(bruto)) return recusa("fora_do_pacote", bruto, chave)
    const abs = expandirHome(bruto, home)
    if (isAbsolute(abs) && existsSync(abs)) return aceita(abs, chave)
  }
  return null
}

const chavesDeclaradas = (qg) => CHAVES.filter((k) => typeof qg?.[k] === "string" && qg[k].length > 0)

/**
 * Recusa pela FORMA da config, ou `null` quando ela declara consumidor.
 *
 * As duas recusas são separadas de propósito: config sem `quality_gate` nenhum e
 * config com `quality_gate` que não nomeia consumidor são problemas diferentes,
 * e fundi-las esconderia qual deles o usuário precisa corrigir.
 */
function recusaEstrutural(qg) {
  if (!qg || typeof qg !== "object") return recusa("sem_quality_gate")
  return chavesDeclaradas(qg).length === 0 ? recusa("consumidor_nao_declarado") : null
}

/** Cópia do pacote, quando existe — o mesmo original que o instalador copia. */
function origemNoPacote(packageRoot) {
  const p = packageRoot ? join(packageRoot, ORIGEM_NO_PACOTE) : null
  return p && existsSync(p) ? p : null
}

export function resolverGstackCheck(config, { home, packageRoot } = {}) {
  const qg = config?.quality_gate
  const estrutural = recusaEstrutural(qg)
  if (estrutural) return estrutural

  const declaradas = chavesDeclaradas(qg)
  const porChave = porChaveDeclarada(qg, declaradas, home)
  if (porChave) return porChave

  const pacote = origemNoPacote(packageRoot)
  if (pacote) return aceita(pacote, "package")
  return recusa("arquivo_ausente", expandirHome(qg[declaradas[0]], home), declaradas[0])
}

/**
 * O caminho resolvido está DENTRO de uma raiz permitida?
 *
 * Separado de `resolverGstackCheck` de propósito: resolver é sobre encontrar,
 * isto é sobre autorizar. Quem chama precisa poder fazer a segunda pergunta
 * mesmo quando a primeira veio de outro lugar.
 */
export function dentroDeRaizPermitida(caminho, raizes) {
  const alvo = resolve(String(caminho ?? ""))
  return raizes.some((r) => {
    const rel = relative(resolve(r), alvo)
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
  })
}

/** Campos que a saída de SUCESSO precisa carregar. */
export const CAMPOS_DE_SUCESSO = Object.freeze([
  "project", "mode", "stack", "infra", "topology", "edges",
  "graphify", "context7", "chronicle", "diagnostic_text",
])

/** Campo único da saída de ERRO — o contrato tem duas formas, não uma. */
export const CAMPO_DE_ERRO = "error"

/**
 * Valida a saída do consumidor: JSON PURO, forma conhecida, exit code coerente.
 *
 * As três perguntas são separadas porque falham por motivos diferentes, e juntar
 * esconderia qual delas fechou. `exitCode` faz parte do contrato: a forma de erro
 * SAI diferente de zero, e a de sucesso sai zero — um `gc.py` que reportasse erro
 * com código 0 quebraria todo consumidor que decide por exit code.
 */
/** Objeto JSON, ou `null` quando o stdout não é UM documento puro. */
function documentoPuro(stdout) {
  let doc = null
  try {
    doc = JSON.parse(String(stdout ?? ""))
  } catch {
    return null
  }
  return doc !== null && typeof doc === "object" && !Array.isArray(doc) ? doc : null
}

const problemasDeErro = (doc, exitCode) => [
  ...(typeof doc.error === "string" && doc.error.length > 0 ? [] : ["`error` precisa ser frase não vazia"]),
  ...(exitCode === 0 ? ["forma de erro com exit code 0 — quem decide por código não veria a falha"] : []),
]

function problemasDeSucesso(doc, exitCode) {
  const faltando = CAMPOS_DE_SUCESSO.filter((c) => !(c in doc))
  return [
    ...(faltando.length > 0 ? [`campos ausentes: ${faltando.join(", ")}`] : []),
    ...(exitCode === 0 ? [] : [`forma de sucesso com exit code ${exitCode}`]),
  ]
}

export function validarSaidaGstackCheck(stdout, exitCode) {
  const doc = documentoPuro(stdout)
  if (!doc) {
    return { ok: false, kind: null, problemas: ["stdout não é UM documento JSON puro"] }
  }
  const kind = CAMPO_DE_ERRO in doc ? "error" : "success"
  const problemas = kind === "error" ? problemasDeErro(doc, exitCode) : problemasDeSucesso(doc, exitCode)
  return { ok: problemas.length === 0, kind, problemas }
}
