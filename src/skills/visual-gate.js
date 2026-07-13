import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { createHash } from "crypto"
import { recordSkillEvidence } from "./evidence.js"

/**
 * Visual Validation Gate EXECUTADO (PRD36 36.9 — base do PRD37 37.2).
 *
 * Antes o `visual-validation-gate` era só DECLARADO (Playwright era dependência,
 * mas nada abria o navegador). Agora o gate EXECUTA: abre a página, captura
 * screenshot + console + rede + acessibilidade como EVIDÊNCIA e só declara
 * `validated` com prova de navegador limpa. Sem driver de browser, retorna
 * `needs_browser` e o gate BLOQUEIA — nunca finge verde (nada é enfeite).
 *
 * O driver do navegador é INJETÁVEL (contrato abaixo): o driver real é Playwright
 * (lazy-import; ausente → `browserDriverAvailable=false`). PURO/testável com um
 * driver fake que devolve a observação.
 *
 * Contrato do driver:
 *   async observe(url, { screenshotPath }) => {
 *     screenshotPath: string|null,
 *     console: [{ type: "log"|"warning"|"error", text }],
 *     network: [{ url, status }],
 *     a11y:    { violations: [{ id, impact, nodes }] },
 *   }
 */

export const VISUAL_GATE_SCHEMA = "gstack.visual-gate.v1"

/** True se o driver real de navegador (Playwright) é resolvível neste ambiente. */
export function browserDriverAvailable(resolve = (m) => import.meta.resolve?.(m)) {
  for (const m of ["playwright", "@playwright/test"]) {
    try { if (resolve(m)) return true } catch { /* segue */ }
  }
  return false
}

/**
 * Driver real (Playwright). Lazy-import: se ausente, retorna null (honesto) — o
 * gate então reporta `needs_browser`, nunca inventa evidência.
 */
/**
 * Probe de acessibilidade REAL (PRD41 S41.6 / P1.1): injeta o axe-core na página e roda.
 * Antes o driver devolvia `a11y: { violations: [] }` HARDCODED — dizia "acessível" sem
 * NUNCA checar. Agora: axe-core presente → violações reais + `checked:true`; ausente →
 * `checked:false` (a11y NÃO verificada — honesto, jamais fingido como limpo).
 */
const A11Y_UNCHECKED = Object.freeze({ checked: false, violations: [] })

async function loadAxeSource() {
  try {
    const axe = await import("axe-core")
    return axe.source || (axe.default && axe.default.source) || null
  } catch { return null }
}

export async function defaultA11yProbe(page) {
  const source = await loadAxeSource()
  if (!source || typeof page.evaluate !== "function") return { ...A11Y_UNCHECKED }
  await page.evaluate(source)
  const result = await page.evaluate(async () => window.axe.run(document))
  return { checked: true, violations: result.violations || [] }
}

export async function playwrightDriver({ headless = true, a11yProbe = defaultA11yProbe } = {}) {
  let pw
  try { pw = await import("playwright") } catch { return null }
  return {
    async observe(url, { screenshotPath } = {}) {
      const browser = await pw.chromium.launch({ headless })
      try {
        const page = await browser.newPage()
        const consoleMsgs = []
        const network = []
        page.on("console", (m) => consoleMsgs.push({ type: m.type(), text: m.text() }))
        page.on("response", (r) => network.push({ url: r.url(), status: r.status() }))
        await page.goto(url, { waitUntil: "load", timeout: 30000 })
        if (screenshotPath) await page.screenshot({ path: screenshotPath })
        const a11y = await a11yProbe(page)
        return { screenshotPath: screenshotPath || null, console: consoleMsgs, network, a11y }
      } finally { await browser.close() }
    },
  }
}

// Regras determinísticas do "validated" (cada uma: quantidade → mensagem|null). Cada
// motivo de falha é DISTINTO e acionável (evidência × console × rede × a11y).
const PROBLEM_RULES = Object.freeze([
  (o) => (o.screenshotPath ? null : "screenshot ausente"),
  // P1.1: screenshot DECLARADO mas ausente/adulterado no disco → falha por EVIDÊNCIA
  // (não confiar no path — verificar existência e hash).
  (o) => (o.screenshotPath && o.screenshotMissing ? "evidência inválida: screenshot declarado, ausente no disco" : null),
  (o) => (o.screenshotPath && o.expectedHash && o.screenshotHash && o.expectedHash !== o.screenshotHash ? "evidência adulterada: hash do screenshot diverge" : null),
  (o) => { const n = (o.console || []).filter((m) => m.type === "error").length; return n ? `${n} erro(s) no console` : null },
  (o) => { const n = (o.network || []).filter((r) => r.status >= 400).length; return n ? `${n} request(s) >= 400` : null },
  (o) => { const n = (o.a11y?.violations || []).length; return n ? `${n} violação(ões) de acessibilidade` : null },
])

// Problemas que impedem "validated" — determinísticos, nunca o LLM decide.
function collectProblems(obs) {
  return PROBLEM_RULES.map((rule) => rule(obs)).filter(Boolean)
}

// Quatro LENTES determinísticas sobre o app rodando (QA/engenharia/segurança/produto) —
// heurísticas, jamais LLM. Cada lente reporta ok + achados acionáveis.
const LENS_RULES = Object.freeze({
  qa: (o) => (o.console || []).filter((m) => m.type === "error").map((m) => `console.error: ${m.text}`),
  engineering: (o) => (o.network || []).filter((r) => r.status >= 500).map((r) => `5xx: ${r.url} (${r.status})`),
  security: (o) => (o.network || []).filter((r) => /^http:\/\//i.test(r.url || "")).map((r) => `request inseguro (http): ${r.url}`),
  product: (o) => (o.a11y?.violations || []).filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `a11y ${v.impact}: ${v.id}`),
})

/** Avalia as 4 lentes sobre a observação. PURO/determinístico. */
export function evaluateLenses(observation = {}) {
  const lenses = {}
  for (const [name, rule] of Object.entries(LENS_RULES)) {
    const findings = rule(observation)
    lenses[name] = { ok: findings.length === 0, findings }
  }
  return lenses
}

/** Hash sha256 de um arquivo de evidência (ou null se ausente/ilegível). Injetável. */
function hashEvidenceFile(path, io) {
  const rd = io || { existsSync, readFileSync }
  if (!path || !rd.existsSync(path)) return null
  try { return "sha256:" + createHash("sha256").update(rd.readFileSync(path)).digest("hex") } catch { return null }
}

/** Verifica a evidência de screenshot no disco (existência + hash) sem confiar no path. */
export function verifyScreenshotEvidence(observation = {}, io) {
  const path = observation.screenshotPath
  if (!path) return { ...observation, screenshotMissing: false, screenshotHash: null }
  const hash = hashEvidenceFile(path, io)
  return { ...observation, screenshotMissing: hash === null, screenshotHash: hash }
}

/**
 * Avalia o gate a partir de uma observação (ou ausência dela). PURO.
 *  - !uiChanged                 → not_applicable (não bloqueia);
 *  - sem observação/unavailable → needs_browser, BLOQUEIA (sem prova não valida);
 *  - problemas (console/rede/a11y/screenshot) → failed, BLOQUEIA;
 *  - limpo                      → validated.
 */
export function evaluateVisualGate({ uiChanged = false, observation = null } = {}) {
  const base = { schemaVersion: VISUAL_GATE_SCHEMA, gate: "visual-validation-gate", uiChanged }
  if (!uiChanged) return { ...base, status: "not_applicable", blocked: false, problems: [] }
  if (!observation || observation.status === "unavailable") {
    return { ...base, status: "needs_browser", blocked: true, problems: ["sem driver de navegador — instale playwright para executar o gate visual"] }
  }
  return evaluatedResult(base, observation)
}

/** Monta o resultado a partir da observação capturada (problemas + lentes + evidência). */
function evaluatedResult(base, observation) {
  const problems = collectProblems(observation)
  const a11y = observation.a11y || {}
  return {
    ...base,
    status: problems.length ? "failed" : "validated",
    blocked: problems.length > 0,
    problems,
    lenses: evaluateLenses(observation),
    a11yChecked: Boolean(a11y.checked),
    screenshotPath: observation.screenshotPath || null,
    screenshotHash: observation.screenshotHash || null,
  }
}

/** Observa a página com o driver (ou reporta unavailable). Nunca finge evidência: a
 * evidência de screenshot é VERIFICADA no disco (existência + hash), não pelo path. */
export async function observePage({ url, runDir, driver, io } = {}) {
  if (!driver) return { status: "unavailable", reason: "driver de navegador ausente" }
  const screenshotPath = runDir ? join(runDir, "visual", "screenshot.png") : null
  const obs = await driver.observe(url, { screenshotPath })
  const verified = verifyScreenshotEvidence({ url, ...obs }, io)
  return { status: "captured", ...verified }
}

/**
 * Executa o gate de ponta a ponta: observa → avalia → GRAVA evidência tipada no
 * Evidence Ledger. Retorna o resultado do gate. Sem driver → needs_browser (blocked).
 */
function persistVisualEvidence(root, runId, result, url, io) {
  recordSkillEvidence({
    root, runId, kind: result.screenshotPath ? "screenshot" : "verify",
    gate: "visual-validation-gate", status: result.status,
    detail: result.problems.join("; ") || `validated (${url})`,
    ...(io ? { io } : {}),
  })
}

export async function runVisualGate({ root, runId, url, uiChanged = true, driver = null, io = undefined, fsIo = undefined } = {}) {
  const runDir = root && runId ? join(root, ".gstack", "runs", runId) : null
  const observation = uiChanged ? await observePage({ url, runDir, driver, io: fsIo }) : null
  const result = evaluateVisualGate({ uiChanged, observation })
  if (root && runId) persistVisualEvidence(root, runId, result, url, io)
  return { ...result, url }
}
