import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import { stripBom } from "../util/json.js"
import { buildReceipt, verifyChain, GENESIS } from "./attestation.js"

/**
 * Provenance log (PRD 13 §10.3). Append-only em `.gstack/provenance/actions.jsonl`
 * + `index.json` por run. Hash chain POR RUN (cada recibo encadeia o último do mesmo
 * run). Redação ANTES de persistir (segredo nunca em claro; o hash cobre o conteúdo
 * já redigido, então a cadeia continua válida). Logs por workspace, não global.
 */

export function provenanceDir(projectDir) { return join(projectDir, ".gstack", "provenance") }
function actionsPath(projectDir) { return join(provenanceDir(projectDir), "actions.jsonl") }
function indexPath(projectDir) { return join(provenanceDir(projectDir), "index.json") }

export function readAllReceipts(projectDir) {
  const p = actionsPath(projectDir)
  if (!existsSync(p)) return []
  return readFileSync(p, "utf-8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(stripBom(l)) } catch { return null } }).filter(Boolean)
}

export function readRun(projectDir, runId) {
  return readAllReceipts(projectDir).filter((r) => r.runId === runId)
}

export function lastHashForRun(projectDir, runId) {
  const run = readRun(projectDir, runId)
  return run.length ? run[run.length - 1].receiptHash : GENESIS
}

function redactStr(s, secrets) {
  if (s == null) return s
  let v = String(s)
  for (const sec of secrets || []) if (sec && String(sec).length >= 4) v = v.split(String(sec)).join("***")
  return v
}

/**
 * Registra uma ação: redige segredos, encadeia no último recibo do run e ANEXA.
 * `input`/`output` viram HASH (nunca crus). Retorna o recibo gravado.
 */
export function recordAction(projectDir, opts = {}) {
  mkdirSync(provenanceDir(projectDir), { recursive: true })
  const secrets = opts.secretValues || []
  const target = opts.target ? { ...opts.target, pathOrName: redactStr(opts.target.pathOrName, secrets) } : opts.target
  const previousHash = opts.previousHash || lastHashForRun(projectDir, opts.runId)
  const receipt = buildReceipt({ ...opts, target, intent: redactStr(opts.intent, secrets), previousHash })
  appendFileSync(actionsPath(projectDir), JSON.stringify(receipt) + "\n")
  updateIndex(projectDir, receipt)
  return receipt
}

function updateIndex(projectDir, receipt) {
  let idx = { runs: {} }
  try { if (existsSync(indexPath(projectDir))) idx = JSON.parse(stripBom(readFileSync(indexPath(projectDir), "utf-8"))) } catch { /* recria */ }
  if (!idx.runs) idx.runs = {}
  const run = idx.runs[receipt.runId] || { count: 0, first: receipt.timestamp }
  run.count += 1
  run.last = receipt.timestamp
  run.lastHash = receipt.receiptHash
  idx.runs[receipt.runId] = run
  writeFileSync(indexPath(projectDir), JSON.stringify(idx, null, 2) + "\n")
}

export function listRuns(projectDir) {
  try {
    const idx = JSON.parse(stripBom(readFileSync(indexPath(projectDir), "utf-8")))
    return Object.entries(idx.runs || {}).map(([id, r]) => ({ runId: id, ...r }))
  } catch { return [] }
}

export function verifyRun(projectDir, runId) {
  return verifyChain(readRun(projectDir, runId))
}
