import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.0A — hotfix de honestidade das claims públicas (achado 4.3).
 *
 * A v5.56.0 foi publicada no npm com o README afirmando "hoje 20 REAL / 1
 * PARTIAL / 0 RISK". O auditor comportamental do commit retorna 4 REAL / 20
 * NOT_PROVED. Documentação pública NUNCA pode fixar um número de auditoria que
 * muda com o código (§3 do PRD: "documentação pública não pode fixar números de
 * auditoria que mudam com o código").
 */

// Um placar de dream audit fixado como estado ATUAL: "<n> REAL" perto de
// PARTIAL/RISK. Em CHANGELOG entradas históricas descrevem o passado — o gate é
// sobre docs de estado atual (README e guias), não o histórico versionado.
const FIXED_SCOREBOARD = /\b\d+\s+REAL\b[^.\n]*\b(PARTIAL|PLACEBO|RISK)\b/i
const PRESENT_TENSE_HINT = /\bhoje\b|\batual\b|\bagora\b/i

const PUBLIC_STATE_DOCS = ["README.md", "docs/guides/capabilities.md"]

test("CONTROLE NEGATIVO: nenhum doc público de estado fixa placar numérico de dream audit", async () => {
  for (const rel of PUBLIC_STATE_DOCS) {
    let text
    try { text = readFileSync(path.join(repoRoot, rel), "utf-8") } catch { continue }
    assert.ok(!FIXED_SCOREBOARD.test(text), `${rel} contém placar fixo de dream audit — use a fonte viva (\`dream audit --json\`)`)
  }
})

test("README aponta para a FONTE VIVA do placar, não para um número", async () => {
  const readme = readFileSync(path.join(repoRoot, "README.md"), "utf-8")
  assert.match(readme, /dream audit/i, "README ainda cita dream audit")
  // Onde cita dream audit, não pode ter número fixo com pretérito/presente afirmado.
  const line = readme.split("\n").find((l) => /dream audit/i.test(l) && /REAL/i.test(l))
  if (line) {
    assert.ok(!(FIXED_SCOREBOARD.test(line) && PRESENT_TENSE_HINT.test(line)),
      `a linha do README fixa um placar como estado atual: "${line.trim()}"`)
  }
})

// --- a fonte viva: o placar deriva do auditor real, nunca é hardcoded ---
test("scoreboard vivo: buildDreamScoreboard deriva do summary REAL do auditor", async () => {
  const { buildDreamScoreboard } = await imp("src/dream/scoreboard.js")
  const board = buildDreamScoreboard({ REAL: 4, PARTIAL: 1, NOT_PROVED: 20, RISK: 0, PLACEBO: 0 })
  assert.equal(board.schemaVersion, "gstack.dream-scoreboard.v1")
  assert.equal(board.counts.REAL, 4)
  assert.equal(board.counts.NOT_PROVED, 20)
  assert.match(board.line, /4 REAL/)
  assert.match(board.line, /20 NOT_PROVED/, "o placar honesto MOSTRA os NOT_PROVED, não os esconde")
})

test("scoreboard vivo: declara a proveniência (commit/data) — nunca um número solto", async () => {
  const { buildDreamScoreboard } = await imp("src/dream/scoreboard.js")
  const board = buildDreamScoreboard({ REAL: 4, PARTIAL: 1, NOT_PROVED: 20 }, { commit: "abc1234", generatedAt: "2026-07-23" })
  assert.equal(board.provenance.commit, "abc1234")
  assert.ok(board.provenance.generatedAt)
})

test("CONTROLE NEGATIVO: o scoreboard nunca infla REAL com NOT_PROVED", async () => {
  const { buildDreamScoreboard } = await imp("src/dream/scoreboard.js")
  const board = buildDreamScoreboard({ REAL: 4, NOT_PROVED: 20 })
  assert.notEqual(board.counts.REAL, 24, "NOT_PROVED jamais vira REAL")
  assert.ok(!/24 REAL|20 REAL/.test(board.line), "nunca reporta 20/24 REAL a partir de 4 REAL")
})

test("scoreboardFromAudit: consome o audit real e produz o placar honesto", async () => {
  const { scoreboardFromAudit } = await imp("src/dream/scoreboard.js")
  const board = scoreboardFromAudit({ summary: { REAL: 4, PARTIAL: 1, NOT_PROVED: 20, RISK: 0, PLACEBO: 0 }, scope: { headCommit: "deadbeef" } })
  assert.equal(board.counts.REAL, 4)
  assert.equal(board.provenance.commit, "deadbeef")
})
