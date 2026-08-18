import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs"
import { join, dirname, relative, isAbsolute } from "path"
import { spawnSync } from "child_process"
import { auditExternalSkills, renderAuditMarkdown } from "../skills/external-audit.js"
import { notebookLmDoctor, notebookLmConnect, notebookLmQuery, notebookLmImport } from "../tools/notebooklm.js"
import { classifyLevel, resolveLevel } from "../epistemic/classifier.js"
import { runBalancedProtocol, runSanityReview } from "../epistemic/protocol.js"
import { renderEpistemicHuman } from "../epistemic/render.js"
import { exitCodeForVerdict } from "../epistemic/schema.js"
import { section, success, warn, error, info, confirm } from "../cli/index.js"

/**
 * `research skills audit --path <dir> | --repo <url>` (PRD29 29.5 / PRD34 F6-A).
 *
 * KNOWLEDGE layer: nunca edita fonte. Audita um MIRROR read-only de skills
 * externas e grava `.gstack/research/external-audit.{json,md}`. NUNCA executa
 * script do repo externo, NUNCA instala, NUNCA lê `.env`. `--repo` é opt-in
 * (rede) e faz clone raso desabilitando hooks; `--path` audita um mirror local.
 */

// Candidatos: SKILL.md/AGENTS.md/*.skill.md em qualquer lugar, ou arquivos de
// texto sob hooks/commands/agents/skills. Nunca abre `.env*`, `.git`, node_modules.
const CAND_NAME = /^SKILL\.md$|^AGENTS?\.md$|\.skill\.md$/i
const CAND_DIR = /(^|\/)(hooks|commands|agents|skills)\//i
const CAND_EXT = /\.(md|py|sh|ps1|js|ts|ya?ml|json)$/i
const skipEntry = (name) => name === ".git" || name === "node_modules" || name.startsWith(".env")

function isCandidate(rel) {
  const posix = rel.replaceAll("\\", "/")
  const base = posix.split("/").pop()
  if (CAND_NAME.test(base)) return true
  return CAND_DIR.test("/" + posix) && CAND_EXT.test(base)
}

function walkCandidates(root, dir, out, limit) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= limit) return
    if (skipEntry(e.name)) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) walkCandidates(root, abs, out, limit)
    else if (isCandidate(relative(root, abs))) out.push(relative(root, abs).replaceAll("\\", "/"))
  }
}

const safeRead = (p) => { try { return readFileSync(p, "utf-8") } catch { return "" } }

export function collectMirrorFiles(dir) {
  const rels = []
  walkCandidates(dir, dir, rels, 2000)
  return rels.sort().map((rel) => ({ path: rel, content: safeRead(join(dir, rel)) }))
}

function readManifest(dir) {
  try { return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) } catch { return null }
}

const flagValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

const manifestProvenance = (man, fallbackSource) => ({
  source: (man && man.url) || fallbackSource,
  commit: (man && man.commit) || null,
})

function resolveLocalMirror(path, cwd) {
  if (!path) return null
  const dir = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(dir)) { error(`research: --path não existe: ${dir}`); return null }
  return { dir, ...manifestProvenance(readManifest(dir), path) }
}

// Clone RASO read-only (opt-in, rede). Desabilita hooks; nunca roda script do repo.
function cloneReadOnly(url, dir) {
  mkdirSync(dirname(dir), { recursive: true })
  const r = spawnSync("git", ["-c", "core.hooksPath=", "clone", "--depth", "1", url, dir], { encoding: "utf-8" })
  if (r.status === 0) return true
  error(`research: clone falhou (${(r.stderr || "").trim() || r.error})`)
  return false
}

function headCommit(dir) {
  const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf-8" })
  return (head.stdout || "").trim() || null
}

// PRD51 S51.4.3 — achado real: mirror só clonava `if (!existsSync(dir))` — depois
// da 1ª vez, `--repo <url>` nunca re-clonava/atualizava, servindo silenciosamente
// o snapshot do 1º clone pra sempre (auditoria ficava presa no passado). Refresh
// raso (fetch+reset) mantém a MESMA garantia read-only/hooks-desabilitados.
function refreshMirror(dir) {
  const fetch = spawnSync("git", ["-C", dir, "-c", "core.hooksPath=", "fetch", "--depth", "1", "origin", "HEAD"], { encoding: "utf-8" })
  if (fetch.status !== 0) { error(`research: refresh do mirror falhou (${(fetch.stderr || "").trim() || fetch.error})`); return false }
  const reset = spawnSync("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"], { encoding: "utf-8" })
  return reset.status === 0
}

function mirrorRepo(url, cwd) {
  const name = url.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")
  const dir = join(cwd, ".gstack", "research", "mirrors", name)
  const ok = existsSync(dir) ? refreshMirror(dir) : cloneReadOnly(url, dir)
  if (!ok) return null
  return { dir, source: url, commit: headCommit(dir) }
}

function writeAuditArtifacts(cwd, audit) {
  const dir = join(cwd, ".gstack", "research")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "external-audit.json"), JSON.stringify(audit, null, 2) + "\n")
  writeFileSync(join(dir, "external-audit.md"), renderAuditMarkdown(audit))
  return dir
}

function renderAuditHuman(audit, dir) {
  const c = audit.counts
  section(`skills externas — ${audit.provenance.auditedFiles} arquivos (read-only)`)
  info(`  fonte: ${audit.provenance.source || "(local)"} · commit ${audit.provenance.commit || "?"}`)
  success(`  adopt ${c.adopt}`)
  info(`  adapt ${c.adapt} (rever/mapear antes de usar)`)
  if (c.avoid > 0) warn(`  avoid ${c.avoid} (destrutivo/exec-remoto/secret/install — nunca adotar sem revisão)`)
  info(`  nada executado/instalado · JSON: ${dir}\\external-audit.json`)
}

// PRD51 S51.4.3 — achado real: `--repo` disparava clone/fetch (efeito de rede)
// sem NENHUM gate de consentimento. Mesmo padrão de `plan run`/`visual hooks
// install`: `--yes` explícito, TTY interativo, ou `opts.confirm` injetado.
const wantsAutoYes = (args, opts) => args.includes("--yes") || args.includes("-y") || opts.yes === true
const canPromptConfirm = (opts) => Boolean(opts.confirm) || Boolean(process.stdin.isTTY)
function emitCancelled(json) {
  const cancelled = { cancelled: true }
  if (json) process.stdout.write(JSON.stringify(cancelled) + "\n")
  return cancelled
}
function repoRefused(json, autoYes, opts) {
  if (autoYes || canPromptConfirm(opts)) return false
  if (json) process.stdout.write(JSON.stringify({ error: "needs_confirmation", hint: "use --yes" }) + "\n")
  else { section("research skills audit --repo"); error("Modo não-interativo: confirme explicitamente com --yes (efeito de rede).") }
  return true
}
async function repoConsentGate(url, json, autoYes, doConfirm) {
  if (autoYes) return true
  if (!json) { section("research skills audit --repo"); info(`  Vai clonar/atualizar via rede (read-only, hooks desabilitados): ${url}`) }
  const ok = await doConfirm(`Clonar/atualizar mirror read-only de ${url}?`, false)
  if (!ok && !json) info("Cancelado.")
  return ok
}
async function grantRepoConsent(repo, json, opts, args) {
  const autoYes = wantsAutoYes(args, opts)
  if (repoRefused(json, autoYes, opts)) return { error: "needs_confirmation" }
  const doConfirm = opts.confirm || confirm
  if (!(await repoConsentGate(repo, json, autoYes, doConfirm))) return emitCancelled(json)
  return null
}
// Resolve o mirror (local ou --repo, com gate de consentimento) num ÚNICO ponto
// de decisão — mantém `auditCmd` linear (extração contra CRAP).
async function resolveMirror(cwd, args, json, opts) {
  const repo = flagValue(args, "--repo")
  if (!repo) return { mirror: resolveLocalMirror(flagValue(args, "--path"), cwd) }
  const refusal = await grantRepoConsent(repo, json, opts, args)
  return refusal ? { refusal } : { mirror: mirrorRepo(repo, cwd) }
}
/**
 * ERRO DE USO sob `--json` — documento puro, nunca prosa.
 *
 * Corrige `P1.CLI-JSON-EXIT-CODE.b`: os erros de uso saíam pelo canal HUMANO
 * mesmo sob `--json`, com escapes ANSI. Quem chamava errado recebia texto
 * colorido onde esperava documento, e o consumidor de máquina não tinha como
 * distinguir erro de uso de payload malformado — as duas coisas chegavam como
 * "isto não parseia".
 *
 * `code` é estável e legível por máquina: o consumidor decide pelo CÓDIGO, não
 * parseando prosa. É o mesmo contrato de `ctxFail` em `context.js`.
 *
 * O ramo humano chega como THUNK, e não como string. A razão é de MEDIÇÃO, e foi
 * cobrada pelo inventário: passar a frase como argumento tira o literal do
 * callsite de um sink, e o extrator deixa de enxergá-lo — 4 pontos de mensagem
 * sumiram do censo na primeira versão desta correção. Dentro do arrow, o callee
 * continua sendo `error`/`warn`, e a mensagem segue contada onde sempre esteve.
 */
const RESEARCH_USAGE_SCHEMA = "gstack.research.usage-error.v1"

function researchUsageFail(json, code, humano, exitCode = 1) {
  process.exitCode = exitCode
  if (json) {
    process.stdout.write(JSON.stringify({
      schemaVersion: RESEARCH_USAGE_SCHEMA, ok: false, error: code,
    }) + "\n")
    return null
  }
  humano()
  return null
}

function emitNoMirror(repo, json) {
  if (repo) { process.exitCode = 1; return null }
  return researchUsageFail(json, "missing_source",
    () => error("research skills audit: informe --path <dir> ou --repo <url>"))
}
function emitAudit(mirror, cwd, json) {
  const audit = auditExternalSkills({ source: mirror.source, commit: mirror.commit, files: collectMirrorFiles(mirror.dir) })
  const dir = writeAuditArtifacts(cwd, audit)
  if (json) { process.stdout.write(JSON.stringify(audit) + "\n"); return audit }
  renderAuditHuman(audit, dir)
  return audit
}
async function auditCmd(cwd, args, json, opts) {
  const { mirror, refusal } = await resolveMirror(cwd, args, json, opts)
  if (refusal) return refusal
  if (!mirror) return emitNoMirror(flagValue(args, "--repo"), json)
  return emitAudit(mirror, cwd, json)
}

/**
 * Emite o payload do conector NotebookLM: serializado sob `--json`, renderizado
 * pelo `humanFn` fora dele.
 *
 * O tipo GENÉRICO não é decoração e não muda comportamento nenhum: ele diz o que
 * a função já fazia — o renderizador humano recebe EXATAMENTE o payload que
 * entrou. Sem isso o parâmetro do callback é implicitamente `any`, e o acesso a
 * campo lá dentro não resolve para declaração alguma; com isso, `p.message` em
 * `notebookLmConnectCmd` resolve para o literal que o produz
 * (`src/tools/notebooklm.js`). É o que permite decidir a provenance daquele
 * ponto por resolução do checker em vez de por leitura.
 *
 * @template P
 * @param {P} payload
 * @param {boolean} json
 * @param {(p: P) => void} humanFn
 * @returns {P}
 */
function emitNotebookLm(payload, json, humanFn) {
  if (json) { process.stdout.write(JSON.stringify(payload) + "\n"); return payload }
  humanFn(payload)
  return payload
}

function notebookLmDoctorCmd(json) {
  const r = notebookLmDoctor()
  return emitNotebookLm(r, json, (p) => {
    section("research notebooklm doctor")
    warn(`  status: ${p.status} — conector experimental, cloud, não-oficial`)
  })
}

function notebookLmConnectCmd(json) {
  const r = notebookLmConnect()
  return emitNotebookLm(r, json, (p) => { section("research notebooklm connect"); warn(`  ${p.message}`) })
}

function notebookLmQueryCmd(args, json) {
  const notebookId = flagValue(args, "--notebook")
  const question = flagValue(args, "--question")
  if (!notebookId || !question) {
    return researchUsageFail(json, "missing_notebook_or_question",
      () => error("research notebooklm query: informe --notebook <id> --question <texto>"))
  }
  const r = notebookLmQuery({ notebookId, question })
  return emitNotebookLm(r, json, (p) => { section("research notebooklm query"); warn(`  status: ${p.status} (${p.category})`) })
}

function readImportResult(resultPath) {
  try { return JSON.parse(readFileSync(resultPath, "utf-8")) } catch { return null }
}

function notebookLmImportCmd(args, json) {
  const resultPath = flagValue(args, "--result")
  const to = flagValue(args, "--to")
  const approved = args.includes("--approved") // explícito na linha de comando -- --yes NUNCA basta (ver costGateStatus/spendConfirmed em outras sprints)
  if (!resultPath || !to) {
    return researchUsageFail(json, "missing_result_or_target",
      () => error("research notebooklm import: informe --result <artefato> --to context|obsidian"))
  }
  const result = readImportResult(resultPath)
  if (!result) {
    return researchUsageFail(json, "unreadable_result",
      () => error(`research notebooklm import: não consegui ler/parsear ${resultPath}`))
  }
  const r = notebookLmImport({ result, approved, to })
  if (!r.ok) process.exitCode = 1
  return emitNotebookLm(r, json, (p) => {
    section("research notebooklm import")
    ;(p.ok ? success : error)(p.ok ? `  importado para ${p.to} com ${p.sourceCitations.length} citação(ões)` : `  recusado: ${p.reason}`)
  })
}

const NOTEBOOKLM_HANDLERS = Object.freeze({
  doctor: (args, json) => notebookLmDoctorCmd(json),
  connect: (args, json) => notebookLmConnectCmd(json),
  query: (args, json) => notebookLmQueryCmd(args, json),
  import: (args, json) => notebookLmImportCmd(args, json),
})

function notebookLmCmd(sub, args, json) {
  const handler = NOTEBOOKLM_HANDLERS[sub[1]]
  if (handler) return handler(args, json)
  return researchUsageFail(json, "unknown_subcommand",
    () => error("research notebooklm: use doctor|connect|query|import"))
}

// ── PRD50 S50.4: `research validate` (§13.1) ────────────────────────────────
// KNOWLEDGE: read-only. Nunca executa código, nunca chama rede sem autorização
// explícita. Sem `--network`, as trilhas de busca ficam vazias e o resultado é
// honestamente inconclusive — jamais um `supported` sem fonte.

// Sinais determinísticos derivados do texto do claim (§9.1). Heurística
// declarada: é classificação de RISCO, não julgamento do conteúdo.
const RISK_SIGNALS = Object.freeze([
  { rx: /segur|security|secret|senha|token|vulnerab/i, signal: "securityImpact" },
  { rx: /release|publicar|deploy|produç|production/i, signal: "releaseImpact" },
  { rx: /irrevers|apagar|deletar|destru|drop\s+/i, signal: "irreversible" },
  { rx: /inédito|novidade|estado da arte|state of the art|primeiro a/i, signal: "noveltyClaim" },
  { rx: /versão|version|lançou|latest|hoje|atual|recente/i, signal: "externalInfoNeeded" },
  { rx: /função|arquivo|módulo|código|depend|arquitet|api\b/i, signal: "codeClaim" },
])

function signalsFromQuestion(text) {
  const s = {}
  for (const { rx, signal } of RISK_SIGNALS) if (rx.test(text)) s[signal] = true
  // Sem nenhum sinal, o classificador aplica o fail-safe para grounded (§9.3).
  return s
}

// Sem `--network` as trilhas externas ficam vazias — nada é inventado.
const OFFLINE_TRAILS = Object.freeze({ findSupport: () => [], findRefutation: () => [], findBoundaries: () => [] })

function reviewForLevel(question, level) {
  if (level === "sanity") return runSanityReview({ question, answer: question, limitations: [] })
  return runBalancedProtocol({ question, level, claimTexts: [question], deps: OFFLINE_TRAILS })
}

function annotateReview(review, { classified, resolved, networkAllowed }) {
  review.classificationReasons = [...classified.reasons, resolved.reason]
  review.level = resolved.level
  if (!networkAllowed) review.notPerformed.push("rede não autorizada (--network ausente) — nenhuma fonte externa consultada")
  if (!resolved.mayClaimVerified) review.notPerformed.push("nível rebaixado por escolha explícita — este resultado não pode alegar verificação")
  return review
}

function validateCmd(args, json) {
  const question = args.filter((a) => !a.startsWith("-") && a !== "validate").join(" ").trim()
  if (!question) {
    // exit 2 preservado: era o código deste erro de uso antes da correção, e
    // mudá-lo quebraria automação que já o distingue de falha de veredito.
    return researchUsageFail(json, "missing_claim",
      () => error('research validate: informe o claim ou pergunta. Ex.: research validate "X reduz Y" --level auto'), 2)
  }
  const classified = classifyLevel(signalsFromQuestion(question))
  const resolved = resolveLevel({ classified: classified.level, requested: flagValue(args, "--level") || "auto" })
  const review = annotateReview(reviewForLevel(question, resolved.level), {
    classified, resolved, networkAllowed: args.includes("--network"),
  })
  process.exitCode = exitCodeForVerdict(review.verdict, { strict: args.includes("--strict") })
  if (json) { process.stdout.write(JSON.stringify(review) + "\n"); return review }
  section(`research validate — ${resolved.level}`)
  console.log(renderEpistemicHuman(review))
  return review
}

function printResearchUsage() {
  section("research")
  info("  research skills audit --path <dir> [--json]   audita mirror local read-only (adopt/adapt/avoid)")
  info("  research skills audit --repo <url> [--json] [--yes]   clona/atualiza raso (rede, pede confirmação) e audita — nunca executa/instala")
  info("  research notebooklm doctor|connect|query|import   conector experimental (cloud, não-oficial)")
  info('  research validate "<claim>" [--level auto|sanity|grounded|adversarial] [--network] [--strict] [--json]')
  warn("  validate é KNOWLEDGE: nunca executa código; experimentos saem como plano p/ `workflow`.")
}

/** Rota do subcomando, ou `null` quando nenhuma reconhece. */
function rotaDeResearch(sub) {
  if (sub[0] === "skills" && sub[1] === "audit") return (cwd, args, json, opts) => auditCmd(cwd, args, json, opts)
  if (sub[0] === "notebooklm") return (_cwd, args, json) => notebookLmCmd(sub, args, json)
  if (sub[0] === "validate") return (_cwd, args, json) => validateCmd(args, json)
  return null
}

/**
 * Sem subcomando reconhecido: o humano recebe o usage; a máquina recebe um
 * DOCUMENTO. Imprimir o usage sob `--json` era a mesma falha do
 * `P1.CLI-JSON-EXIT-CODE.b`, na porta de entrada — e a mais provável de um
 * consumidor encontrar, porque basta errar o nome do subcomando.
 */
function researchSemRota(json) {
  if (json) return researchUsageFail(json, "unknown_subcommand", () => {})
  // Sem `--json`, `research` sozinho e AJUDA, e ajuda nao e erro: sai com 0, como
  // `--help`. Sob `--json` e outra coisa -- uma maquina pediu documento e a
  // chamada estava malformada --, e ai o status precisa dizer isso.
  printResearchUsage()
  return null
}

/** Dispatcher do `research`. */
export async function researchCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const json = args.includes("--json")
  const sub = args.filter((a) => !a.startsWith("-"))
  const rota = rotaDeResearch(sub)
  return rota ? rota(cwd, args, json, opts) : researchSemRota(json)
}
