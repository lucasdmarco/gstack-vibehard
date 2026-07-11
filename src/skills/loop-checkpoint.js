import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { createHash } from "crypto"

/**
 * Checkpoints Replit-like (PRD37 37.4 — Fase D4). Como o Replit: cada checkpoint
 * é um SNAPSHOT real de código + contexto do ciclo, com ROLLBACK ao último ponto
 * VERDE. Guardado em `.gstack/runs/<runId>/checkpoints/<seq>/` — **NÃO é git
 * commit** (não toca no histórico do usuário nem no index).
 *
 * Honestidade (nada é enfeite):
 *  - o rollback só restaura o que foi REALMENTE capturado (nunca finge restaurar
 *    arquivo fora do snapshot); cada arquivo é gravado com seu sha256;
 *  - "verde" é o checkpoint em que o diagnose PASSOU (D3) — rollbackToLastGreen
 *    volta ao último estado provado, ou falha honestamente se não houver;
 *  - snapshot só de contexto (sem `files`) é rotulado `hasCode:false` — não mente
 *    que salvou código.
 *
 * PURO/testável: io injetável.
 */

export const CHECKPOINT_SCHEMA = "gstack.loop-checkpoint.v1"

const checkpointsDir = (root, runId) => join(root, ".gstack", "runs", runId, "checkpoints")
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

const defaultIo = Object.freeze({
  readBuf: (p) => (existsSync(p) ? readFileSync(p) : null),
  readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
  write: (p, data) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data) },
  exists: (p) => existsSync(p),
  listDirs: (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []),
})

// Próximo número de sequência = 1 + maior seq existente (checkpoints são <seq>/).
function nextSeq(root, runId, io) {
  const seqs = io.listDirs(checkpointsDir(root, runId)).map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n))
  return seqs.length ? Math.max(...seqs) + 1 : 1
}

// Grava um arquivo do working tree dentro do snapshot; devolve a entrada do manifesto.
function snapshotFile(root, seqDir, rel, io) {
  const buf = io.readBuf(join(root, rel))
  if (buf == null) return { path: rel, missing: true }
  io.write(join(seqDir, "files", rel), buf)
  return { path: rel, sha256: sha256(buf), bytes: buf.length }
}

/**
 * Cria um checkpoint: snapshot dos `files` (relativos ao root) + contexto (`state`).
 * `green` marca um ponto provado (diagnose passou). Retorna o manifesto.
 */
export function createCheckpoint({ root, runId, files = [], state = null, green = false, note = "", io = defaultIo, now = () => new Date().toISOString() } = {}) {
  const seq = nextSeq(root, runId, io)
  const seqDir = join(checkpointsDir(root, runId), String(seq))
  const captured = files.map((rel) => snapshotFile(root, seqDir, rel, io))
  const manifest = {
    schemaVersion: CHECKPOINT_SCHEMA, seq, at: now(), green: Boolean(green), note,
    iteration: state?.consumed?.iterations ?? 0,
    hasCode: captured.some((f) => !f.missing),
    files: captured,
    context: state ? { intent: state.intent, phase: state.phase, verdict: state.verdict } : null,
  }
  io.write(join(seqDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  return manifest
}

/** Lê todos os manifestos de checkpoint, ordenados por seq crescente. */
export function listCheckpoints({ root, runId, io = defaultIo } = {}) {
  const base = checkpointsDir(root, runId)
  return io.listDirs(base)
    .map((n) => io.readText(join(base, n, "manifest.json")))
    .filter(Boolean)
    .map((raw) => { try { return JSON.parse(raw) } catch { return null } })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq)
}

/** Último checkpoint VERDE (maior seq com green:true) ou null. */
export function lastGreenCheckpoint({ root, runId, io = defaultIo } = {}) {
  const green = listCheckpoints({ root, runId, io }).filter((c) => c.green)
  return green.length ? green[green.length - 1] : null
}

// Restaura o conteúdo salvo de um arquivo capturado de volta ao working tree.
function restoreFile(root, seqDir, entry, io) {
  if (entry.missing) return false
  const buf = io.readBuf(join(seqDir, "files", entry.path))
  if (buf == null) return false
  io.write(join(root, entry.path), buf)
  return true
}

/**
 * Rollback para um checkpoint específico: restaura os arquivos capturados. Só
 * restaura o que existe no snapshot (honesto). Retorna { ok, restored, seq }.
 */
export function rollbackToCheckpoint({ root, runId, seq, io = defaultIo } = {}) {
  const manifest = listCheckpoints({ root, runId, io }).find((c) => c.seq === seq)
  if (!manifest) return { ok: false, reason: `checkpoint ${seq} inexistente`, restored: [] }
  const seqDir = join(checkpointsDir(root, runId), String(seq))
  const restored = manifest.files.filter((entry) => restoreFile(root, seqDir, entry, io)).map((entry) => entry.path)
  return { ok: true, seq, green: manifest.green, restored }
}

/** Rollback ao último ponto VERDE; falha honestamente se não houver nenhum. */
export function rollbackToLastGreen({ root, runId, io = defaultIo } = {}) {
  const green = lastGreenCheckpoint({ root, runId, io })
  if (!green) return { ok: false, reason: "nenhum checkpoint verde — nada provado para onde voltar", restored: [] }
  return rollbackToCheckpoint({ root, runId, seq: green.seq, io })
}
