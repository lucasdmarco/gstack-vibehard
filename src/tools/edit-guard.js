import { createHash } from "crypto"
import { recordAction } from "../vfa/provenance.js"

/**
 * Hash-Anchored Edit Guard (PRD24 Sprint 24.6). Inspirado no hashline do oh-my-openagent
 * para reduzir erro de edição stale-line: ao LER um arquivo para editar, gera um hash
 * curto do trecho (âncora); ANTES de aplicar o patch, revalida que o trecho ainda bate.
 * Se stale, ABORTA com erro recuperável (peça nova leitura) e registra no provenance.
 *
 * PURO/injetável: `anchorHash`/`makeAnchor`/`validateAnchor`/`guardedEdit` não tocam
 * disco. O provenance é side-effect OPT-IN via `provenanceRecorder`. Normaliza CRLF→LF
 * para o hash ser estável entre plataformas.
 */

const norm = (s) => String(s == null ? "" : s).replace(/\r\n?/g, "\n")

/** Hash curto e determinístico de um trecho (12 hex ~ 48 bits). */
export function anchorHash(text) {
  return createHash("sha256").update(norm(text)).digest("hex").slice(0, 12)
}

/** Extrai as linhas [lineStart, lineEnd] (1-indexed, inclusivo) do conteúdo. */
export function excerpt(content, lineStart, lineEnd) {
  const lines = norm(content).split("\n")
  const a = Math.max(1, lineStart | 0)
  const b = Math.min(lines.length, lineEnd | 0)
  return lines.slice(a - 1, b).join("\n")
}

/** Cria a âncora no momento da LEITURA (para posterior validação da edição). */
export function makeAnchor(content, lineStart, lineEnd) {
  const snippet = excerpt(content, lineStart, lineEnd)
  return { lineStart, lineEnd, hash: anchorHash(snippet), length: snippet.length }
}

/** Valida a âncora contra o conteúdo ATUAL. `{ ok, stale, reason }`. */
export function validateAnchor(currentContent, anchor) {
  if (!anchor || typeof anchor.hash !== "string") {
    return { ok: false, stale: true, reason: "âncora ausente/inválida — releia o arquivo antes de editar" }
  }
  const actual = anchorHash(excerpt(currentContent, anchor.lineStart, anchor.lineEnd))
  if (actual !== anchor.hash) {
    return { ok: false, stale: true, reason: `trecho mudou desde a leitura (linhas ${anchor.lineStart}-${anchor.lineEnd}) — releia antes de editar`, expected: anchor.hash, actual }
  }
  return { ok: true, stale: false }
}

/**
 * Aplica uma edição SÓ se a âncora ainda bate. Se stale, aborta de forma RECUPERÁVEL
 * (não lança) e sinaliza para reler. `apply()` é o efeito; `record(ev)` é opcional.
 */
export function guardedEdit(opts = {}) {
  const check = validateAnchor(opts.currentContent, opts.anchor)
  if (!check.ok) {
    if (opts.record) opts.record({ intent: "edit_guard_stale", decision: "block", reason: check.reason, anchor: opts.anchor })
    return { applied: false, stale: true, recoverable: true, reason: check.reason }
  }
  const result = opts.apply ? opts.apply() : null
  if (opts.record) opts.record({ intent: "edit_guard_apply", decision: "allow", anchor: opts.anchor })
  return { applied: true, stale: false, result }
}

/** Recorder de provenance para o guard (opt-in; best-effort, nunca quebra a edição). */
export function provenanceRecorder(cwd, runId) {
  return (ev) => {
    try {
      recordAction(cwd, {
        runId,
        intent: ev.intent,
        actor: { harness: "gstack", agent: "edit-guard" },
        target: { kind: "anchor", pathOrName: `L${ev.anchor ? ev.anchor.lineStart : "?"}-${ev.anchor ? ev.anchor.lineEnd : "?"}` },
        policy: { decision: ev.decision, rules: ["hash-anchored-edit"] },
      })
    } catch { /* provenance best-effort */ }
  }
}
