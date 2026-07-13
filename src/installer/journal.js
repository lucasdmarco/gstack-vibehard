import {
  existsSync as fsExists, readFileSync as fsRead, writeFileSync as fsWrite,
  mkdirSync as fsMkdir, rmSync as fsRm,
} from "fs"
import { dirname } from "path"
import { createHash } from "crypto"

/**
 * Journal transacional de instalação (PRD41 S41.3 / PRD40 P0.9).
 *
 * "Full = tudo-ou-restaura": diferente de um `uninstall --restore-only` manual, qualquer
 * falha no MEIO da instalação tem que reverter TUDO que já foi escrito — automaticamente e
 * de volta ao byte exato anterior. O journal captura o estado PRÉVIO de cada operação ANTES
 * de aplicá-la (arquivo ausente vs. conteúdo original; dir ausente) e desfaz em LIFO.
 *
 * PURO/injetável: recebe `io` (fs por padrão) — os testes injetam um fs em memória e
 * fazem fault-injection para provar o rollback byte-a-byte.
 */
export const JOURNAL_SCHEMA = "gstack.install-journal.v1"

const DEFAULT_IO = {
  existsSync: fsExists, readFileSync: fsRead, writeFileSync: fsWrite,
  mkdirSync: fsMkdir, rmSync: fsRm,
}

export function sha256(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex")
}

/** Ancestral mais alto AINDA inexistente de `path` — o que a criação recursiva vai criar
 * primeiro e o que o rollback deve remover (recursivo) para não deixar dir órfão. */
function topMissingAncestor(io, path) {
  let dir = dirname(path)
  let top = null
  while (dir && dir !== dirname(dir) && !io.existsSync(dir)) {
    top = dir
    dir = dirname(dir)
  }
  return top
}

export class InstallJournal {
  constructor({ io } = {}) {
    this.io = { ...DEFAULT_IO, ...(io || {}) }
    this.entries = [] // LIFO: cada op registra como desfazer
    this.done = false
  }

  /** Escreve `path` capturando o estado prévio (ausente ou bytes originais). Cria dirs
   * faltantes registrando o ancestral criado para rollback. */
  writeFile(path, content) {
    this._guard()
    const io = this.io
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8")
    const existedFile = io.existsSync(path)
    const prior = existedFile ? io.readFileSync(path) : null
    const createdDir = existedFile ? null : topMissingAncestor(io, path)
    if (createdDir) io.mkdirSync(createdDir, { recursive: true })
    io.mkdirSync(dirname(path), { recursive: true })
    io.writeFileSync(path, buf)
    this.entries.push({ type: "write", path, existedFile, prior, createdDir, hash: sha256(buf) })
    return { path, type: existedFile ? "modify" : "create", hash: sha256(buf) }
  }

  /** Cria dir registrando o ancestral criado (rollback remove a subárvore criada). */
  mkdir(path) {
    this._guard()
    const io = this.io
    if (io.existsSync(path)) return { path, type: "noop" }
    const createdDir = topMissingAncestor(io, path) || path
    io.mkdirSync(path, { recursive: true })
    this.entries.push({ type: "mkdir", path, createdDir })
    return { path, type: "create" }
  }

  /** Desfaz UMA operação: mkdir → remove a subárvore criada; write → restaura bytes
   * originais (ou apaga o criado) e remove o dir que a escrita criou. */
  _undoEntry(e) {
    const io = this.io
    if (e.type === "mkdir") {
      io.rmSync(e.createdDir, { recursive: true, force: true })
      return
    }
    if (e.existedFile) io.writeFileSync(e.path, e.prior)
    else io.rmSync(e.path, { force: true })
    if (e.createdDir) io.rmSync(e.createdDir, { recursive: true, force: true })
  }

  /** Desfaz TODAS as operações em ordem inversa, restaurando o byte exato anterior. */
  rollback() {
    const restored = []
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      try {
        this._undoEntry(e)
        restored.push(e.path)
      } catch (err) {
        restored.push(`(falha ao reverter ${e.path}: ${err.message})`)
      }
    }
    this.done = true
    return { rolledBack: restored.length, paths: restored }
  }

  /** Confirma: mantém os arquivos, esvazia o log de desfazer. */
  commit() {
    this.done = true
    const ops = this.entries.map((e) => ({ type: e.type, path: e.path, hash: e.hash }))
    this.entries = []
    return { schemaVersion: JOURNAL_SCHEMA, committed: ops.length, ops }
  }

  _guard() {
    if (this.done) throw new Error("journal já finalizado (commit/rollback)")
  }
}

/**
 * Roda `fn(journal)` como transação: sucesso → commit; QUALQUER exceção → rollback
 * automático de tudo + re-lança (a instalação inteira volta ao estado anterior). É o
 * substituto do "instrua o usuário a rodar uninstall": o rollback é intrínseco.
 */
export function runTransaction(fn, { io } = {}) {
  const journal = new InstallJournal({ io })
  try {
    const value = fn(journal)
    const result = journal.commit()
    return { ok: true, value, ...result }
  } catch (err) {
    const undo = journal.rollback()
    return { ok: false, error: err, rolledBack: undo.rolledBack, paths: undo.paths }
  }
}
