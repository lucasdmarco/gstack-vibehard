import { lintCommands, lintShellFences, ALL_CLI_COMMANDS } from "./command-lint.js"

/**
 * Lint dos manuais INTERNOS (PRD51 S51.10.3, §51.10 item 5 dos Manuais).
 *
 * Contexto que recalibrou este módulo duas vezes, antes de escrever qualquer linha:
 *
 *  1. `command-lint.js` já protege a superfície PÚBLICA — README.md, README.en.md e
 *     `docs/guides/*.md`, com gate real de CI. Reconstruir aquilo aqui seria duplicação.
 *  2. Rodando o extrator existente contra os manuais: `projetogstack.md` cita 21 comandos
 *     e ZERO inexistentes; `manualdeengenhariacomia.md` cita ZERO comandos (é um manual
 *     de engenharia vendor-neutral, não fala da CLI). Ou seja, o detector de comando
 *     pedido pelo item 5 passaria trivialmente hoje: é guarda de REGRESSÃO, não conserto.
 *
 * O drift real do manual nunca foi comando inventado — é a BASELINE declarada envelhecer
 * em silêncio (v5.19.0 contra uma CLI muito à frente) enquanto o texto segue afirmando
 * capacidades como se fossem daquela versão. Nenhum linter de comando pega isso. Por isso
 * este módulo verifica as duas coisas, e a segunda é a que tem valor hoje.
 *
 * FRONTEIRA IMPORTANTE: manual GUIA o produto, não FAZ PARTE dele. Não entra no tarball
 * (o `files` do package.json é allowlist e não inclui `.docs/`), não é runtime de agente,
 * não vai para o contexto padrão do usuário. Este lint existe para impedir que uma claim
 * interna envelhecida vaze para a documentação pública — nunca para empacotar o manual.
 *
 * `.docs/` é gitignored: a CI NÃO tem esses arquivos. Ausência é `skipped`, jamais falha.
 */
export const MANUAL_LINT_SCHEMA = "gstack.manual-lint.v1"

/**
 * Manuais internos auditados. `checksCommands:false` é uma decisão registrada, não um
 * esquecimento — ver `reason`.
 */
export const INTERNAL_MANUALS = Object.freeze([
  {
    path: ".docs/PLANS/projetogstack.md",
    checksCommands: true,
    checksBaseline: true,
    reason: null,
  },
  {
    path: ".docs/PLANS/manualdeengenhariacomia.md",
    checksCommands: false,
    checksBaseline: false,
    reason: "Manual de engenharia vendor-neutral: não cita comandos do GStack (zero citações, verificado com o extrator real) e não declara baseline de versão. Rodar os dois checks aqui produziria verde vazio, que é pior que não checar — dá impressão de cobertura onde não há o que cobrir.",
  },
])

// `> Baseline consultada: CLI local `v5.19.0`, em 2026-07-21.`
const BASELINE_RE = /Baseline\s+consultada:\s*CLI\s+local\s*`?v?(\d+\.\d+\.\d+)`?(?:\s*,\s*em\s*(\d{4}-\d{2}-\d{2}))?/i

/** Baseline DECLARADA pelo manual. `null` honesto quando o manual não declara nenhuma. */
export function parseDeclaredBaseline(text) {
  const m = BASELINE_RE.exec(String(text))
  if (!m) return null
  return { version: m[1], date: m[2] || null }
}

const majorOf = (v) => Number(String(v).split(".")[0])
const minorOf = (v) => Number(String(v).split(".")[1])

/**
 * Drift entre a baseline declarada e a versão real da CLI.
 *
 * Manual SEM baseline declarada é drift (`missing_baseline`): um manual que não diz a que
 * versão se refere não pode ser conferido por ninguém — é a pior das situações, não a
 * neutra. Divergência de MAJOR ou MINOR conta; PATCH não, porque o manual descreve
 * capacidade e um patch não muda capacidade.
 */
export function baselineDrift(declared, cliVersion) {
  if (!declared) return { drifted: true, kind: "missing_baseline", declared: null, actual: cliVersion }
  const same = majorOf(declared.version) === majorOf(cliVersion) && minorOf(declared.version) === minorOf(cliVersion)
  return {
    drifted: !same,
    kind: same ? null : "stale_baseline",
    declared: declared.version,
    declaredAt: declared.date,
    actual: cliVersion,
  }
}

const absent = (m) => ({ path: m.path, skipped: true, reason: "ausente (`.docs/` é gitignored — esperado na CI)" })

// Manual presente mas com TODOS os checks desligados NÃO é "verde": nada foi verificado.
// Devolver `ok:true` aqui produziria impressão de cobertura onde não há o que cobrir — o
// mesmo verde vazio que este módulo existe para evitar.
const notApplicable = (m) => ({ path: m.path, skipped: true, notApplicable: true, reason: m.reason || "nenhum check aplicável a este manual" })

const hasText = (m) => m.text !== null && m.text !== undefined
const noChecks = (m) => !m.checksCommands && !m.checksBaseline

const commandFindings = (m, known) => (m.checksCommands
  ? { unknown: lintCommands(m.text, known), shellFences: lintShellFences(m.text) }
  : { unknown: [], shellFences: [] })

const baselineFinding = (m, cliVersion) => (m.checksBaseline
  ? baselineDrift(parseDeclaredBaseline(m.text), cliVersion)
  : null)

const isClean = (cmd, drift) => cmd.unknown.length === 0 && cmd.shellFences.length === 0 && !(drift && drift.drifted)

/** Avalia UM manual. Extraído do `map` e decomposto por CC (limiar de bloqueio do QG). */
function evaluateManual(m, cliVersion, known) {
  if (!hasText(m)) return absent(m)
  if (noChecks(m)) return notApplicable(m)
  const cmd = commandFindings(m, known)
  const drift = baselineFinding(m, cliVersion)
  return {
    path: m.path,
    skipped: false,
    checked: { commands: m.checksCommands, baseline: m.checksBaseline },
    unknown: cmd.unknown,
    shellFences: cmd.shellFences,
    drift,
    ok: isClean(cmd, drift),
  }
}

/**
 * Lint agregado. `manuals` = [{ path, text|null, checksCommands, checksBaseline }] —
 * `text:null` significa arquivo ausente (CI sem `.docs/`), o que vira `skipped`.
 *
 * `ok` é falso apenas por problema REAL num manual PRESENTE. Ausência nunca reprova:
 * um gate que falha porque o arquivo não foi distribuído estaria punindo a CI por um
 * fato de design (`.docs/` é gitignored de propósito).
 */
export function runManualLint({ manuals = [], cliVersion = "0.0.0", known = ALL_CLI_COMMANDS } = {}) {
  const perManual = manuals.map((m) => evaluateManual(m, cliVersion, known))
  const avaliados = perManual.filter((r) => !r.skipped)
  return {
    schemaVersion: MANUAL_LINT_SCHEMA,
    ok: avaliados.every((r) => r.ok),
    checked: avaliados.length,
    skipped: perManual.filter((r) => r.skipped && !r.notApplicable).length,
    notApplicable: perManual.filter((r) => r.notApplicable).length,
    perManual,
  }
}
