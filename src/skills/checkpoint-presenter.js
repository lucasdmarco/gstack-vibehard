/**
 * PRD48 S48.4 — checkpoint como produto. Wrapper fino sobre o motor JÁ REAL
 * (`loop-checkpoint.js`, PRD41 S41.7) — não reimplementa snapshot/tamper-detection.
 * `restoreWithProvenance` acrescenta o que faltava: um recibo APPEND-ONLY (provenance,
 * PRD13 §10.3) do próprio ato de restaurar — o audit trail nunca é apagado, só cresce.
 */
import { listCheckpoints, rollbackToCheckpoint } from "./loop-checkpoint.js"
import { recordAction } from "../vfa/provenance.js"

export const CHECKPOINT_PRESENTER_SCHEMA = "gstack.checkpoint-presenter.v1"

/** Lista checkpoints com rótulo humano — wrapper fino, sem duplicar loop-checkpoint.js. */
export function presentCheckpoints({ root, runId, io } = {}) {
  return listCheckpoints({ root, runId, io }).map((c) => ({
    seq: c.seq, green: c.green, at: c.at, note: c.note,
    fileCount: c.files.filter((f) => !f.missing).length,
  }))
}

/** Diff simples entre 2 manifests de checkpoint — só os arquivos que mudaram de hash. */
export function diffCheckpoints(a, b) {
  const byPath = (list) => new Map((list || []).map((f) => [f.path, f.sha256]))
  const ma = byPath(a?.files)
  const mb = byPath(b?.files)
  const changed = [...mb.keys()].filter((p) => ma.get(p) !== mb.get(p))
  return { schemaVersion: CHECKPOINT_PRESENTER_SCHEMA, changed }
}

/**
 * Restore REAL (`rollbackToCheckpoint`, fail-closed em tamper) + recibo de provenance
 * append-only do próprio ato — nunca apaga histórico anterior, só adiciona. Tamper
 * detectado nunca grava recibo de sucesso falso (o rollback já falhou antes de qualquer
 * escrita, e nada é registrado como "restaurado").
 */
export function restoreWithProvenance({ root, runId, seq, io } = {}) {
  const result = rollbackToCheckpoint({ root, runId, seq, io })
  if (!result.ok) return result
  const receipt = recordAction(root, {
    runId, tool: "checkpoint-restore",
    target: { kind: "checkpoint", pathOrName: `seq-${seq}` },
    intent: `restore para checkpoint ${seq}`,
    policy: { decision: "allow", rules: ["checkpoint-restore"] },
  })
  return { ...result, provenanceReceipt: receipt.receiptHash }
}
