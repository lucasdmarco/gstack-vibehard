import { readFileSync } from "fs"
import { join } from "path"
import { execFileSync as defaultExec } from "child_process"
import { checkSourceParity } from "../release/source-parity.js"
import { contractFor } from "../dream/claim-contract.js"
import { audit as defaultAudit } from "../dream/auditor.js"
import { construirMatriz, problemasDaDeclaracao } from "./../release/support-matrix.js"
import { CORE_EVIDENCE_IDS } from "./golden-workflow-vertical.js"

/**
 * publish-guard — check determinístico de checkpoint para publicar um pacote.
 *
 * Automatiza o ritual manual de release (tree limpa? versão bumpada? CHANGELOG?
 * tag? CI verde?). Tudo local/git, sem LLM, sem rede obrigatória (CI é opcional
 * via `gh`). `exec` é injetável → testes não tocam git/rede real.
 *
 * Checks HARD (bloqueiam): package-version, tree-clean, version-bump, changelog-entry.
 * Soft: tag-exists (warning), ci-green (not_applicable sem `gh`).
 *
 * @returns {{ status:"pass"|"fail", version:string|null, checks:Array, failed:string[], warnings:string[] }}
 */
const gitOf = (exec, cwd) => (...args) => {
  try { return String(exec("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 }) || "").trim() }
  catch { return null }
}
const row = (id, status, detail) => ({ id, status, detail })

// 1. working tree limpa
function checkTreeClean(porcelain) {
  if (porcelain === null) return row("tree-clean", "not_applicable", "não é repositório git")
  if (porcelain === "") return row("tree-clean", "passed", "working tree limpa")
  return row("tree-clean", "failed", treeDirtyDetail(porcelain))
}
// 2. versão bumpada vs última tag semver
const bumpGuide = (version, latest) =>
  (latest.replace(/^v/, "") === version.replace(/^v/, "")
    ? `versão ${version} já tem tag ${latest} — se é NOVA release, bump para a próxima; se é só validação local, use o verify normal (publish é advisory em lib/CLI)`
    : `versão ${version} não está acima da última tag ${latest} — faça o bump antes de publicar`)
/**
 * A tag desta versão aponta para o commit que está sendo publicado?
 *
 * `^{}` desreferencia tag anotada até o commit. Sem isso, uma tag anotada nunca
 * bateria com `HEAD` e o check reprovaria a release correta.
 */
function tagDestaVersaoNoHead(git, version) {
  if (typeof git !== "function") return false
  const alvo = git("rev-parse", `v${version}^{}`)
  const head = git("rev-parse", "HEAD")
  return Boolean(alvo && head && alvo === head)
}

/**
 * Versão bumpada vs última tag semver.
 *
 * CORREÇÃO (achado ao usar o guard para publicar a 5.107.0): este check e o
 * `release-source-parity` codificavam RITUAIS OPOSTOS e se anulavam.
 *
 *   `version-bump` assumia tag DEPOIS de publicar — o comentário do
 *   `tag-exists` diz isso com todas as letras — e reprovava se a versão já
 *   tivesse tag.
 *
 *   `tagParity` (PRD41 S41.0) passou a exigir a tag ANTES, local e no remoto,
 *   para impedir publicar fonte não auditável.
 *
 * Resultado: sem tag, parity reprovava; com tag, bump reprovava. O guard ficou
 * INSATISFAZÍVEL desde a v4.0.1 — nunca podia dar `pass`, e ninguém percebeu
 * porque a última publicação foi feita sem ele verde.
 *
 * A reconciliação preserva o que cada um protegia: republicar versão já lançada
 * continua reprovando, e versão atrás da última tag também. O que passa a ser
 * aceito é o ÚNICO estado que o parity exige — a tag desta versão existindo e
 * apontando para o commit que se vai publicar.
 */
function checkVersionBump(version, tags, git) {
  const semverTags = tags.filter((t) => /^v?\d+\.\d+\.\d+/.test(t))
  if (semverTags.length === 0) return row("version-bump", "passed", "primeira release (sem tags anteriores)")
  const latest = semverTags.reduce((a, b) => (semverGt(b, a) ? b : a))
  if (semverGt(version, latest)) return row("version-bump", "passed", `${version} > ${latest}`)
  if (latest.replace(/^v/, "") === version.replace(/^v/, "") && tagDestaVersaoNoHead(git, version)) {
    return row("version-bump", "passed", `v${version} é a tag DESTE commit — estado exigido pelo release-source-parity`)
  }
  return row("version-bump", "failed", bumpGuide(version, latest))
}
// 3. CHANGELOG com entrada da versão
function checkChangelog(cwd, version) {
  const changelog = readFile(join(cwd, "CHANGELOG.md")) ?? readFile(join(cwd, "CHANGELOG"))
  if (changelog === null) return row("changelog-entry", "failed", "CHANGELOG.md ausente")
  if (changelog.includes(version)) return row("changelog-entry", "passed", `entrada para ${version} encontrada`)
  return row("changelog-entry", "failed", `CHANGELOG.md sem entrada para ${version}`)
}
// 3.5. QG_VERSION sincronizado com o package — impede release com qg.py stale.
function checkQgVersion(qgVersion, version) {
  if (qgVersion === null) return row("qg-version", "not_applicable", "hooks/hooks/qg.py não encontrado")
  if (qgVersion === version) return row("qg-version", "passed", `qg.py em ${qgVersion}`)
  return row("qg-version", "failed", `qg.py em ${qgVersion} ≠ package ${version} — rode \`node scripts/sync-qg-version.mjs\``)
}
// 4. tag da versão (soft — o fluxo cria a tag após publicar)
function checkTagExists(version, tags) {
  const tagV = `v${version}`
  const has = tags.includes(tagV) || tags.includes(version)
  return row("tag-exists", "warning", has ? `tag ${tagV} já existe (re-publicação?)` : `tag ${tagV} ainda não existe (crie após publicar)`)
}
// 5. CI verde (opcional — só se `gh` disponível e não desabilitado)
function ciConclusion(exec, cwd, branch) {
  try {
    return String(exec("gh", ["run", "list", "--branch", branch, "--limit", "1", "--json", "conclusion", "-q", ".[0].conclusion"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 20000 }) || "").trim()
  } catch { return null }
}
function checkCiGreen(opts, exec, cwd, git) {
  if (opts.checkCi === false || !ghAvailable(exec, cwd)) return row("ci-green", "not_applicable", "CI não verificado (gh ausente ou desabilitado)")
  const concl = ciConclusion(exec, cwd, git("rev-parse", "--abbrev-ref", "HEAD") || "HEAD")
  if (concl === "success") return row("ci-green", "passed", "última run do CI: success")
  if (!concl) return row("ci-green", "not_applicable", "CI sem run consultável")
  return row("ci-green", "warning", `última run do CI: ${concl}`)
}

// Fontes injetáveis isoladas: mantêm os ternários fora do corpo dos checks.
const readVersion = (cwd) => {
  const pkg = readJson(join(cwd, "package.json"))
  if (!pkg || !pkg.version) return null
  return String(pkg.version)
}
const listTags = (git) => (git("tag", "--list") || "").split("\n").map((t) => t.trim()).filter(Boolean)
const dreamOf = (opts) => (opts.dream ? opts.dream() : safeAudit())
const supportMatrixOf = (opts, cwd) => (opts.supportMatrix ? opts.supportMatrix() : construirMatriz({ cwd }))
const capsOf = (opts, cwd) => (opts.capabilityReport ? opts.capabilityReport() : readCapabilityReport(cwd))
const qgOf = (opts, cwd) => (opts.readQgVersion ? opts.readQgVersion(cwd) : readQgVersion(cwd))
const goldenWorkflowOf = (opts, cwd) => (opts.goldenWorkflow ? opts.goldenWorkflow() : readGoldenWorkflowReport(cwd))

function buildChecks({ opts, cwd, exec, git, version, tags }) {
  return [
    row("package-version", "passed", version),
    checkTreeClean(git("status", "--porcelain")),
    checkVersionBump(version, tags, git),
    checkChangelog(cwd, version),
    checkQgVersion(qgOf(opts, cwd), version),
    // release-source-parity (HARD) — impede publicar commit/árvore não auditável a partir
    // da fonte pública (PRD41 S41.0 / P0.2). Sem remoto → not_applicable.
    checkSourceParity({ cwd, exec, version, checkPack: opts.checkPack === true, npmPack: opts.npmPack }),
    // PRD45 S45.0 — não publicar prometendo o que não foi provado.
    checkDreamRequired(dreamOf(opts)),
    checkCapabilityE2E(capsOf(opts, cwd)),
    // PRD47 S47.10 — Golden Workflow (vertical saas-auth-stripe, S47.9): as evidências CORE
    // (offline, sem credencial de terceiro) precisam estar provadas antes de publicar.
    checkGoldenWorkflow(goldenWorkflowOf(opts, cwd)),
    // PRD52 S52.E (§26.3) — a evidência de suporte é uma MATRIZ. O check aparece
    // aqui porque é aqui que se decide publicar, e publicar é o ato que
    // transforma a matriz numa promessa ao usuário.
    checkSupportMatrix(supportMatrixOf(opts, cwd)),
    checkTagExists(version, tags),
    checkCiGreen(opts, exec, cwd, git),
  ]
}

export function publishGuard(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const exec = opts.exec || defaultExec
  const git = gitOf(exec, cwd)
  const version = readVersion(cwd)
  if (!version) return finalize([row("package-version", "failed", "package.json sem campo version")], null)
  return finalize(buildChecks({ opts, cwd, exec, git, version, tags: listTags(git) }), version)
}

const HARD = new Set([
  "package-version", "tree-clean", "version-bump", "changelog-entry", "qg-version", "release-source-parity",
  // PRD45 S45.0: publicar prometendo prova inexistente é o pior defeito possível — HARD.
  "dream-required", "capability-e2e",
  // PRD47 S47.10: Golden Workflow real também é HARD — mas só nas evidências CORE.
  "golden-workflow",
])

const safeAudit = () => { try { return defaultAudit({ behavioral: true }) } catch { return null } }

/**
 * PRD45 S45.0 — `dream NOT_PROVED` de claim REQUIRED bloqueia o publish.
 * "Required" = claim com CONTRATO comportamental declarado (CLAIM_CONTRACTS): ali o produto
 * afirma ter E2E + controle negativo. Se um desses não está REAL, estamos prometendo prova
 * que não existe. Claim SEM contrato pode ser NOT_PROVED honesto (hoje são 19) — travar em
 * todos tornaria o gate insatisfazível, e gate que nunca passa vira enfeite ignorado.
 * RISK/PLACEBO jamais publicam (mesma régua do proof).
 */
const tallyOf = (summary, key) => Number((summary || {})[key]) || 0
// RISK/PLACEBO jamais publicam (mesma régua do proof). @returns detalhe ou null.
function toxicDetail(summary) {
  const risk = tallyOf(summary, "RISK")
  const placebo = tallyOf(summary, "PLACEBO")
  if (risk + placebo === 0) return null
  return `${risk} RISK / ${placebo} PLACEBO — nunca publicar`
}
const requiredClaims = (claims) => claims.filter((c) => contractFor(c.id))
const unprovedDetail = (claims) => requiredClaims(claims)
  .filter((c) => c.status !== "REAL")
  .map((c) => `${c.id}:${c.status}`)

/**
 * §26.3 — a matriz nunca compra verde, e também não inventa vermelho.
 *
 * `not_run` é ausência de execução, e ausência de execução não reprova um
 * release: reprovar por ela transformaria "ninguém mediu" em "está quebrado".
 * O que REPROVA é célula que falhou, célula malformada (`pass` sem os quatro
 * recibos) ou declaração de suporte sem célula verde por baixo.
 */
const chavesFalhas = (m) => m.cells.filter((c) => c.verdict === "fail").map((c) => c.key)

/** As três formas de a matriz REPROVAR, em ordem de precedência. */
const REPROVAS_DA_MATRIZ = Object.freeze([
  {
    when: (m) => m.invalidCells.length > 0,
    detail: (m) => `célula malformada: ${m.invalidCells.map((c) => c.key).join(", ")}`,
  },
  {
    when: (m) => chavesFalhas(m).length > 0,
    detail: (m) => `célula(s) reprovada(s): ${chavesFalhas(m).join(", ")}`,
  },
  {
    when: (m) => problemasDaDeclaracao(m.declaredSupport, m).length > 0,
    detail: (m) => problemasDaDeclaracao(m.declaredSupport, m).join("; "),
  },
])

function checkSupportMatrix(m) {
  const id = "support-matrix"
  if (!m || !Array.isArray(m.cells)) return row(id, "not_applicable", "matriz de suporte indisponível")
  const reprova = REPROVAS_DA_MATRIZ.find((r) => r.when(m))
  if (reprova) return row(id, "failed", reprova.detail(m))
  const total = m.cells.length
  if (m.proven.length === 0) {
    return row(id, "not_applicable", `0/${total} células provadas — nada de cross-OS pode ser afirmado ainda`)
  }
  return row(id, "passed", `${m.proven.length}/${total} células provadas com recibo`)
}

function checkDreamRequired(d) {
  const id = "dream-required"
  if (!d || !Array.isArray(d.claims)) return row(id, "not_applicable", "dream audit indisponível")
  const toxic = toxicDetail(d.summary)
  if (toxic) return row(id, "failed", toxic)
  const unproved = unprovedDetail(d.claims)
  if (unproved.length) return row(id, "failed", `contrato declarado sem prova: ${unproved.join(", ")}`)
  return row(id, "passed", `${requiredClaims(d.claims).length} claim(s) com contrato comportamental REAL`)
}

/**
 * PRD45 S45.0 — capacidade REQUIRED fora de `passed` bloqueia o publish.
 * Cobre `failed` (E2E reprovou), `not_proved` (engine de pé, E2E não rodou — o falso-verde
 * do `dockerAvailable() ? "passed"`) e `blocked_missing_engine` (sem engine: não se publica
 * às cegas). `not_applicable` (plataforma não suporta) é honesto e não é dívida de prova.
 */
const CAP_OK = new Set(["passed", "not_applicable"])
function checkCapabilityE2E(report) {
  const id = "capability-e2e"
  if (!report || !Array.isArray(report.capabilities)) {
    return row(id, "not_applicable", "sem relatório de capacidades — rode `npm run test:cleanmachine`")
  }
  const req = report.capabilities.filter((c) => c.required)
  const bad = req.filter((c) => !CAP_OK.has(c.status))
  if (bad.length) return row(id, "failed", bad.map((c) => `${c.id}:${c.status}`).join(", "))
  return row(id, "passed", `${req.length} capacidade(s) required em passed/not_applicable`)
}
function readCapabilityReport(cwd) {
  return readJson(join(cwd, ".gstack", "reports", "cleanmachine.json"))
}

/**
 * PRD47 S47.10 — só as evidências CORE (offline, sem credencial de terceiro) do
 * Golden Workflow (`golden-workflow-vertical.js`, S47.9) podem travar publish.
 * Stripe/Supabase/painel-browser ficam `blocked`/`not_executed` em QUALQUER
 * máquina sem credencial real e NUNCA são exigidos aqui (DoD linha 6 do S47.9).
 */
function checkGoldenWorkflow(report) {
  const id = "golden-workflow"
  if (!report || !Array.isArray(report.items)) {
    return row(id, "not_applicable", "sem relatório do Golden Workflow — rode `npm run test:vertical`")
  }
  const notCore = CORE_EVIDENCE_IDS.filter((cid) => report.items.find((i) => i.id === cid)?.status !== "proved")
  if (notCore.length) return row(id, "failed", `evidência(s) core não provada(s): ${notCore.join(", ")}`)
  return row(id, "passed", `${CORE_EVIDENCE_IDS.length} evidência(s) core do Golden Workflow provadas`)
}
function readGoldenWorkflowReport(cwd) {
  return readJson(join(cwd, ".gstack", "reports", "vertical.json"))
}

/**
 * Detalhe ACIONÁVEL do tree-clean: lista OS ARQUIVOS (até 5) em vez de só contar
 * (PRD25 25.1 — reportar estado; NUNCA apagar arquivo do usuário). Gate segue HARD.
 */
function treeDirtyDetail(porcelain) {
  const lines = porcelain.split("\n").filter(Boolean)
  const shown = lines.slice(0, 5).map((l) => l.trim()).join(", ")
  const more = lines.length > 5 ? ` (+${lines.length - 5})` : ""
  return `working tree suja (${lines.length} arquivo(s) não commitado(s)): ${shown}${more} — commit, mova ou ignore; nada é apagado`
}

/** Lê QG_VERSION de hooks/hooks/qg.py (label do Quality Gate). null se ausente. */
function readQgVersion(cwd) {
  const src = readFile(join(cwd, "hooks", "hooks", "qg.py"))
  if (src === null) return null
  const m = src.match(/^QG_VERSION = "(.*)"$/m)
  return m ? m[1] : null
}

function finalize(checks, version) {
  const failed = checks.filter((c) => c.status === "failed" && HARD.has(c.id)).map((c) => c.id)
  const warnings = checks.filter((c) => c.status === "warning").map((c) => c.id)
  return { status: failed.length ? "fail" : "pass", version, checks, failed, warnings }
}

function ghAvailable(exec, cwd) {
  try { exec("gh", ["--version"], { cwd, stdio: "pipe", timeout: 5000 }); return true } catch { return false }
}

// [major, minor, patch] — pré-release ignorado (só ordena a linha estável).
const semverParts = (v) => {
  const core = String(v).replace(/^v/, "").split("-")[0].split(".")
  return [0, 1, 2].map((i) => Number.parseInt(core[i], 10) || 0)
}
function semverGt(a, b) {
  const pa = semverParts(a)
  const pb = semverParts(b)
  const i = [0, 1, 2].find((k) => pa[k] !== pb[k])
  if (i === undefined) return false
  return pa[i] > pb[i]
}

function readFile(p) { try { return readFileSync(p, "utf-8") } catch { return null } }
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")) } catch { return null } }
