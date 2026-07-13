import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { createHash } from "crypto"
import { validCheckpointId, screenCheckpointPath, contentHasSecret } from "./checkpoint-guard.js"

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
// FAIL-CLOSED: rejeita path traversal/symlink/denylist ANTES de ler; conteúdo com
// segredo também é negado (nunca captura credencial num checkpoint).
function snapshotFile(root, seqDir, rel, io) {
  const screen = screenCheckpointPath(root, rel)
  if (!screen.ok) return { path: rel, denied: true, reason: screen.reason }
  const buf = io.readBuf(join(root, rel))
  if (buf == null) return { path: rel, missing: true }
  if (contentHasSecret(buf)) return { path: rel, denied: true, reason: "conteúdo contém segredo — não entra em checkpoint" }
  io.write(join(seqDir, "files", rel), buf)
  return { path: rel, sha256: sha256(buf), bytes: buf.length }
}

/**
 * Cria um checkpoint: snapshot dos `files` (relativos ao root) + contexto (`state`).
 * `green` marca um ponto provado (diagnose passou). FAIL-CLOSED: `runId` inválido
 * (traversal) ou QUALQUER arquivo negado (denylist/traversal/segredo) → REJEITA o
 * checkpoint inteiro sem persistir. Retorna o manifesto (ok:true) ou { ok:false }.
 */
export function createCheckpoint({ root, runId, files = [], state = null, green = false, note = "", io = defaultIo, now = () => new Date().toISOString() } = {}) {
  if (!validCheckpointId(runId)) return { ok: false, status: "invalid_run_id", reason: `runId inválido: ${runId}`, files: [] }
  const seq = nextSeq(root, runId, io)
  const seqDir = join(checkpointsDir(root, runId), String(seq))
  const captured = files.map((rel) => snapshotFile(root, seqDir, rel, io))
  const denied = captured.filter((f) => f.denied)
  if (denied.length) return { ok: false, status: "denied", reason: denied[0].reason, denied, files: captured }
  const manifest = {
    schemaVersion: CHECKPOINT_SCHEMA, ok: true, seq, at: now(), green: Boolean(green), note,
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

// Lê o blob salvo de uma entrada e VERIFICA o hash contra o manifesto (anti-tamper).
// Retorna { path, buf } se íntegro, { path, tampered:true } se o blob foi adulterado.
function verifyBlob(seqDir, entry, io) {
  const buf = io.readBuf(join(seqDir, "files", entry.path))
  if (buf == null) return { path: entry.path, missingBlob: true }
  if (entry.sha256 && sha256(buf) !== entry.sha256) return { path: entry.path, tampered: true }
  return { path: entry.path, buf }
}

/**
 * Rollback para um checkpoint específico. FAIL-CLOSED e ATÔMICO: primeiro VERIFICA o
 * hash de TODO blob capturado; se qualquer um foi adulterado → ABORTA (`tamper_detected`)
 * sem escrever nada. Só depois restaura. `seq` externo é validado (inteiro > 0).
 */
export function rollbackToCheckpoint({ root, runId, seq, io = defaultIo } = {}) {
  if (!validCheckpointId(runId)) return { ok: false, reason: `runId inválido: ${runId}`, restored: [] }
  if (!Number.isInteger(seq) || seq < 1) return { ok: false, reason: `seq inválido: ${seq}`, restored: [] }
  const manifest = listCheckpoints({ root, runId, io }).find((c) => c.seq === seq)
  if (!manifest) return { ok: false, reason: `checkpoint ${seq} inexistente`, restored: [] }
  const seqDir = join(checkpointsDir(root, runId), String(seq))
  const present = manifest.files.filter((e) => !e.missing)
  const verified = present.map((e) => verifyBlob(seqDir, e, io))
  const tampered = verified.filter((v) => v.tampered)
  if (tampered.length) return { ok: false, reason: "tamper_detected", tampered: tampered.map((t) => t.path), restored: [] }
  const restored = verified.filter((v) => v.buf != null).map((v) => { io.write(join(root, v.path), v.buf); return v.path })
  return { ok: true, seq, green: manifest.green, restored }
}

/** Rollback ao último ponto VERDE; falha honestamente se não houver nenhum. */
export function rollbackToLastGreen({ root, runId, io = defaultIo } = {}) {
  const green = lastGreenCheckpoint({ root, runId, io })
  if (!green) return { ok: false, reason: "nenhum checkpoint verde — nada provado para onde voltar", restored: [] }
  return rollbackToCheckpoint({ root, runId, seq: green.seq, io })
}
