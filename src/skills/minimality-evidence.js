import { execFileSync as defaultExec } from "child_process"
import { PROTECTED_CONCERNS } from "./minimality-schema.js"

/**
 * PRD51 S51.7.4 — coleta de decision-evidence REAL a partir do diff.
 *
 * `evaluateMinimality` (PRD49 S49.5) era puro, testado e correto — mas
 * `gate-matrix.js` o declarava `declared-only` de propósito, com o comentário
 * honesto "NENHUM caminho hoje popula `decision` a partir de uma implementação
 * real (planner/reviewer não reportam decision-evidence ainda)". Este módulo
 * fecha exatamente esse vão: deriva do diff REAL do git o que é genuinamente
 * derivável, e NUNCA fabrica o que não é.
 *
 * DERIVÁVEL do diff (usado):
 *  - `introducesNewDependency`: dependência nova em package.json (diff real).
 *  - `introducesNewAbstraction`: arquivo-fonte NOVO no diff.
 *  - `protectedConcerns`: do caminho dos arquivos mudados (tests/, security/…).
 *
 * NÃO-DERIVÁVEL (deixado `undefined` de propósito, nunca chutado):
 *  - `existingReuse` / `platformOrStdlib` / `smallestCompleteApproach`: exigem
 *    julgamento sobre alternativas que o diff não contém. Como
 *    `redundantAbstraction` só bloqueia quando reuse está DISPONÍVEL
 *    (`=== true`), deixá-los indefinidos é conservador por construção: nunca
 *    gera bloqueio falso.
 *  - `newDependencyReason`: é justificativa HUMANA. Vem de `opts.declared`
 *    (plano/brief) quando existe; ausente, a dependência nova fica
 *    genuinamente "sem justificativa registrada" — que é o sinal real que o
 *    gate existe pra pegar, não uma lacuna do coletor.
 */
export const MINIMALITY_EVIDENCE_SCHEMA = "gstack.minimality-evidence.v1"

const SOURCE_EXT = /\.(jsx?|tsx?|mjs|cjs|py|go|rs)$/
const isSource = (f) => SOURCE_EXT.test(f) && !f.includes("node_modules")

// Caminho → concern protegido. Deriva do arquivo REAL mudado, sem inferir intenção.
const CONCERN_BY_PATH = Object.freeze([
  { concern: "tests", re: /(^|[/\\])tests?[/\\]|\.(test|spec)\.|__tests__/ },
  { concern: "security", re: /(^|[/\\])(security|auth|crypto)[/\\]/ },
  { concern: "validation", re: /(^|[/\\])(validation|validators?|schema)[/\\]/ },
  { concern: "accessibility", re: /(^|[/\\])(a11y|accessibility)[/\\]/ },
  { concern: "observability", re: /(^|[/\\])(telemetry|observability|logging|metrics)[/\\]/ },
])

/** Concerns protegidos presentes nos arquivos REALMENTE mudados (deduplicado). */
export function protectedConcernsFor(files = []) {
  const hits = new Set()
  for (const f of files) {
    const rel = String(f).replace(/\\/g, "/")
    for (const rule of CONCERN_BY_PATH) if (rule.re.test(rel)) hits.add(rule.concern)
  }
  return [...hits].filter((c) => PROTECTED_CONCERNS.includes(c))
}

const DEP_LINE = /^([+\- ])\s*"([^"]+)"\s*:\s*"/

/**
 * Nomes de dependência ADICIONADOS no diff de package.json.
 *
 * Um nome que aparece em `+` E em `-` NÃO é novo — só mudou de linha (o caso
 * real: adicionar uma dependência faz a anterior reaparecer como `+` só porque
 * ganhou uma vírgula). Sem essa subtração, toda dependência preexistente virava
 * "nova" e o gate acusaria falso-positivo — bug real pego pelo controle
 * negativo `dependência preexistente que só ganhou vírgula`.
 */
const DEPS_BLOCK_OPEN = /^[+\- ]\s*"(dependencies|devDependencies|peerDependencies)"\s*:/
const DEPS_BLOCK_CLOSE = /^[+\- ]\s*\}/

/** Só as linhas do diff que estão DENTRO de um bloco de dependências. */
function depBlockLines(diff) {
  const out = []
  let inDeps = false
  for (const line of String(diff).split("\n")) {
    if (DEPS_BLOCK_OPEN.test(line)) { inDeps = true; continue }
    if (inDeps && DEPS_BLOCK_CLOSE.test(line)) { inDeps = false; continue }
    if (inDeps) out.push(line)
  }
  return out
}

export function addedDependencies(packageJsonDiff = "") {
  const added = new Set()
  const removed = new Set()
  for (const line of depBlockLines(packageJsonDiff)) {
    const m = DEP_LINE.exec(line)
    if (m) (m[1] === "+" ? added : m[1] === "-" ? removed : new Set()).add(m[2])
  }
  return [...added].filter((name) => !removed.has(name))
}

function gitDiff(cwd, exec, args) {
  try { return String(exec("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 }) || "") }
  catch { return "" }
}

/** Arquivos-fonte NOVOS (status `A`) no diff — sinal real de abstração nova. */
export function addedSourceFiles(nameStatusOutput = "") {
  return String(nameStatusOutput).split("\n")
    .map((l) => l.trim()).filter(Boolean)
    .filter((l) => l.startsWith("A"))
    .map((l) => l.split(/\s+/).slice(1).join(" "))
    .filter(isSource)
}

/**
 * Monta a decision-evidence REAL do diff atual. `declared` (opcional) carrega o
 * que só um humano pode informar (ex.: `newDependencyReason` vindo do brief).
 * @returns {{schemaVersion, introducesNewDependency, introducesNewAbstraction, protectedConcerns, addedDependencies, addedFiles, ...}}
 */
export function collectMinimalityEvidence({ cwd = process.cwd(), exec = defaultExec, files = null, declared = {} } = {}) {
  const nameStatus = gitDiff(cwd, exec, ["diff", "--name-status", "HEAD"])
  const pkgDiff = gitDiff(cwd, exec, ["diff", "HEAD", "--", "package.json"])
  const changed = files || nameStatus.split("\n").map((l) => l.trim().split(/\s+/).slice(1).join(" ")).filter(Boolean)
  const deps = addedDependencies(pkgDiff)
  const addedFiles = addedSourceFiles(nameStatus)
  return {
    schemaVersion: MINIMALITY_EVIDENCE_SCHEMA,
    introducesNewDependency: deps.length > 0,
    introducesNewAbstraction: addedFiles.length > 0,
    protectedConcerns: protectedConcernsFor(changed),
    addedDependencies: deps,
    addedFiles,
    // Só o que veio DECLARADO por humano — nunca inferido pelo coletor.
    ...(declared.newDependencyReason ? { newDependencyReason: declared.newDependencyReason } : {}),
    ...(declared.existingReuse !== undefined ? { existingReuse: declared.existingReuse } : {}),
    ...(declared.platformOrStdlib !== undefined ? { platformOrStdlib: declared.platformOrStdlib } : {}),
    ...(declared.smallestCompleteApproach !== undefined ? { smallestCompleteApproach: declared.smallestCompleteApproach } : {}),
  }
}
