import { KNOWLEDGE, EXECUTION, NEUTRAL } from "./command-layers.js"

/**
 * Command-lint (PRD30 30.4 / PRD34 F7-A).
 *
 * A doc só pode citar comando que EXISTE no CLI. Este módulo extrai as invocações
 * explícitas (`gstack_vibehard <cmd>` / `node src/index.js <cmd>`) da doc e cruza
 * com a fonte única de comandos (o firewall Knowledge/Execution). Comando citado
 * que não existe = FALHA (a doc engana o usuário leigo). Também compara PT×EN:
 * conjuntos de comandos divergentes = claim divergente. PURO/testável.
 */

export const COMMAND_LINT_SCHEMA = "gstack.command-lint.v1"

// Fonte única: todo comando real do CLI (mesma base do firewall).
export const ALL_CLI_COMMANDS = Object.freeze([...new Set([...KNOWLEDGE, ...EXECUTION, ...NEUTRAL])].sort())

// Só invocações EXPLÍCITAS, separador horizontal (não cruza linha) — captura o
// comando de topo (primeiro token após o binário); subcomandos/flags são ignorados.
const CMD_PATTERNS = Object.freeze([
  /gstack_vibehard[ \t]+([a-z][a-z-]+)/gi,
  /node[ \t]+src\/index\.js[ \t]+([a-z][a-z-]+)/gi,
])

/** Comandos de topo citados no texto (deduplicados, ordenados). */
export function citedCommands(text) {
  const set = new Set()
  for (const re of CMD_PATTERNS) {
    for (const m of String(text).matchAll(re)) set.add(m[1].toLowerCase())
  }
  return [...set].sort()
}

/** Comandos citados que NÃO existem no CLI. */
export function lintCommands(text, known = ALL_CLI_COMMANDS) {
  const knownSet = new Set(known)
  return citedCommands(text).filter((c) => !knownSet.has(c))
}

/** Comandos citados em um doc e não no outro (claim divergente PT×EN). */
export function commandParity(aText, bText) {
  const a = new Set(citedCommands(aText))
  const b = new Set(citedCommands(bText))
  return {
    onlyInFirst: [...a].filter((c) => !b.has(c)).sort(),
    onlyInSecond: [...b].filter((c) => !a.has(c)).sort(),
  }
}

const parityBalanced = (p) => p.onlyInFirst.length === 0 && p.onlyInSecond.length === 0

/**
 * Lint agregado sobre um par de READMEs. `docs` = [{name, text}] (o 1º e o 2º
 * são comparados para paridade).
 *  - `ok`      = GATE de CI: zero comando inexistente (a doc nunca engana o leigo);
 *  - `parityOk`= paridade PT×EN de comandos citados (reportado; divergência é WARNING,
 *    não bloqueia — READMEs podem detalhar seções distintas sem citar comando falso).
 */
export function runCommandLint({ docs = [], known = ALL_CLI_COMMANDS } = {}) {
  const perFile = docs.map((d) => ({ name: d.name, unknown: lintCommands(d.text, known) }))
  const parity = docs.length >= 2 ? commandParity(docs[0].text, docs[1].text) : { onlyInFirst: [], onlyInSecond: [] }
  const hasUnknown = perFile.some((f) => f.unknown.length > 0)
  return {
    schemaVersion: COMMAND_LINT_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok: !hasUnknown,
    parityOk: parityBalanced(parity),
    perFile,
    parity,
  }
}
