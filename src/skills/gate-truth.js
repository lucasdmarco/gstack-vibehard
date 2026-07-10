import { readFileSync } from "fs"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { EVENT_DECLARATIONS } from "../harness/events.js"

/**
 * Gate Truth (PRD36 36.0) — fonte ÚNICA da verdade dos gates, sempre em 5 estados
 * separados (nunca um "ok" único):
 *
 *  - `declared`  o gate existe na matriz;
 *  - `routed`    o harness recebe o evento onde o gate incide (derivado de
 *                EVENT_DECLARATIONS — a mesma declaração usada pelo conformance);
 *  - `executed`  existe implementação determinística que RODA a checagem
 *                (`implementedBy` na matriz);
 *  - `blocking`  a checagem PODE negar a ação naquele harness (ship = CLI nega;
 *                pre-write = só onde o hook de escrita é `enforced`);
 *  - `proved`    existe TESTE NEGATIVO referenciado (`provedBy`) e o arquivo do
 *                teste existe E contém o nome citado — verificação determinística.
 *
 * Um gate só aparece `enforced` com implementação + bloqueio + teste negativo
 * (executed && blocking && proved). Matriz válida NUNCA vira "12/12" sozinha.
 */

export const GATE_TRUTH_SCHEMA = "gstack.skill-gate-truth.v1"
export const TRUTH_STATES = Object.freeze(["declared", "routed", "executed", "blocking", "proved"])

// Harnesses projetados para skills (mesmo conjunto do harness-projection).
export const TRUTH_HARNESSES = Object.freeze(["claude", "codex", "opencode", "cursor"])

// Evento em que o gate incide, derivado do fallback declarado na matriz.
// SHIP = imposto pela CLI (verify/proof/delegate) → independe do harness.
const SHIP_FALLBACKS = Object.freeze(["block_before_ship", "block_before_delegate"])

/** "ship" | "pre-write" — quando o gate realmente incide. */
export function gateEvent(gate) {
  return SHIP_FALLBACKS.includes(gate.fallback) ? "ship" : "pre-write"
}

// file.write declarado pelo harness (fonte única: events.js, nunca uma cópia local).
function fileWriteLevel(harness) {
  const decl = EVENT_DECLARATIONS[harness]
  return decl ? decl.events["file.write"] : null
}

/** O harness recebe o evento do gate? ship = via CLI (sempre); pre-write = hook real/parcial. */
export function routedIn(gate, harness) {
  if (gateEvent(gate) === "ship") return true
  return ["enforced", "partial"].includes(fileWriteLevel(harness))
}

/** O harness pode NEGAR a ação deste gate? (partial não garante negação) */
function canBlockIn(gate, harness) {
  if (gateEvent(gate) === "ship") return true
  return fileWriteLevel(harness) === "enforced"
}

// ── proved: teste negativo referenciado e VERIFICADO ─────────────────────────────
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

const defaultTruthIo = Object.freeze({
  readTest(rel) {
    try { return readFileSync(join(PACKAGE_ROOT, rel), "utf-8") } catch { return null }
  },
})

/**
 * Verifica a referência `provedBy` de um gate: o arquivo de teste existe e
 * contém o nome citado. → { proved, broken } — broken = citou prova que não existe.
 */
export function verifyProvedBy(gate, io = defaultTruthIo) {
  if (!gate.provedBy) return { proved: false, broken: false }
  const content = io.readTest(gate.provedBy.test)
  const proved = Boolean(content && content.includes(gate.provedBy.name))
  return { proved, broken: !proved }
}

// ── verdade por gate × harness ────────────────────────────────────────────────────
/** Os 5 estados de um gate num harness (proved é pré-computado por gate). */
export function gateTruth(gate, harness, proved) {
  const known = TRUTH_HARNESSES.includes(harness)
  const executed = Boolean(gate.implementedBy)
  const blocking = executed && gate.mode === "blocking" && known && canBlockIn(gate, harness)
  return {
    declared: true,
    routed: known && routedIn(gate, harness),
    executed,
    blocking,
    proved,
  }
}

/** Nível honesto: enforced SÓ com executed+blocking+proved; senão advisory/unsupported. */
export function truthLevel(gate, harness, truth) {
  if (!TRUTH_HARNESSES.includes(harness)) return "unsupported"
  if (gate.mode !== "blocking") return "advisory"
  return truth.executed && truth.blocking && truth.proved ? "enforced" : "advisory"
}

// ── matriz completa ────────────────────────────────────────────────────────────────
function truthRow(gate, harnesses, io) {
  const { proved, broken } = verifyProvedBy(gate, io)
  const byHarness = {}
  for (const h of harnesses) {
    const truth = gateTruth(gate, h, proved)
    byHarness[h] = { ...truth, level: truthLevel(gate, h, truth) }
  }
  return {
    gate: gate.id, mode: gate.mode, event: gateEvent(gate),
    implementedBy: gate.implementedBy || null,
    provedBy: gate.provedBy || null,
    provedByBroken: broken,
    byHarness,
  }
}

/** Matriz gate × harness com os 5 estados + nível honesto. */
export function buildGateTruth({ gates = [], harnesses = TRUTH_HARNESSES, io = defaultTruthIo } = {}) {
  const rows = gates.map((g) => truthRow(g, harnesses, io))
  const brokenRefs = rows.filter((r) => r.provedByBroken).map((r) => r.gate)
  return {
    schemaVersion: GATE_TRUTH_SCHEMA,
    generatedAt: new Date().toISOString(),
    harnesses: [...harnesses],
    ok: brokenRefs.length === 0,
    brokenRefs,
    rows,
    note: "enforced SÓ com implementação + bloqueio real + teste negativo verificado. declared ≠ routed ≠ executed ≠ blocking ≠ proved.",
  }
}

/** Resumo honesto: contagens que NUNCA viram '12/12' só porque a matriz é válida. */
export function truthSummary(truth) {
  const total = truth.rows.length
  const executed = truth.rows.filter((r) => r.executed || Object.values(r.byHarness).some((h) => h.executed)).length
  const proved = truth.rows.filter((r) => Object.values(r.byHarness).some((h) => h.proved)).length
  const enforcedByHarness = {}
  for (const h of truth.harnesses) {
    enforcedByHarness[h] = truth.rows.filter((r) => r.byHarness[h].level === "enforced").length
  }
  return { declared: total, executed, proved, enforcedByHarness, brokenRefs: truth.brokenRefs.length }
}

const mark = (b) => (b ? "✓" : "·")

/** Render markdown da verdade (uma linha por gate × harness compacta). */
export function renderGateTruthMarkdown(truth) {
  const s = truthSummary(truth)
  const lines = [
    `# Gate Truth — declared ${s.declared} · executed ${s.executed} · proved ${s.proved}`, "",
    `Gerado: ${truth.generatedAt} · schema ${truth.schemaVersion}`, "",
    `| Gate | Evento | Impl | Prova |${truth.harnesses.map((h) => ` ${h} |`).join("")}`,
    `|---|---|---|---|${truth.harnesses.map(() => "---|").join("")}`,
  ]
  for (const r of truth.rows) {
    const cells = truth.harnesses.map((h) => {
      const t = r.byHarness[h]
      return ` ${mark(t.routed)}r ${mark(t.executed)}e ${mark(t.blocking)}b ${mark(t.proved)}p → ${t.level} |`
    })
    lines.push(`| ${r.gate} | ${r.event} | ${r.implementedBy ? "✓" : "—"} | ${r.provedBy ? (r.provedByBroken ? "QUEBRADA" : "✓") : "—"} |${cells.join("")}`)
  }
  lines.push("", "r=routed e=executed b=blocking p=proved. " + truth.note, "")
  return lines.join("\n")
}
