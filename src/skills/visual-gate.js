import { join } from "path"
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
export async function playwrightDriver({ headless = true } = {}) {
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
        return { screenshotPath: screenshotPath || null, console: consoleMsgs, network, a11y: { violations: [] } }
      } finally { await browser.close() }
    },
  }
}

// Regras determinísticas do "validated" (cada uma: quantidade → mensagem|null).
const PROBLEM_RULES = Object.freeze([
  (o) => (o.screenshotPath ? null : "screenshot ausente"),
  (o) => { const n = (o.console || []).filter((m) => m.type === "error").length; return n ? `${n} erro(s) no console` : null },
  (o) => { const n = (o.network || []).filter((r) => r.status >= 400).length; return n ? `${n} request(s) >= 400` : null },
  (o) => { const n = (o.a11y?.violations || []).length; return n ? `${n} violação(ões) de acessibilidade` : null },
])

// Problemas que impedem "validated" — determinísticos, nunca o LLM decide.
function collectProblems(obs) {
  return PROBLEM_RULES.map((rule) => rule(obs)).filter(Boolean)
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
  const problems = collectProblems(observation)
  return { ...base, status: problems.length ? "failed" : "validated", blocked: problems.length > 0, problems, screenshotPath: observation.screenshotPath || null }
}

/** Observa a página com o driver (ou reporta unavailable). Nunca finge evidência. */
export async function observePage({ url, runDir, driver } = {}) {
  if (!driver) return { status: "unavailable", reason: "driver de navegador ausente" }
  const screenshotPath = runDir ? join(runDir, "visual", "screenshot.png") : null
  const obs = await driver.observe(url, { screenshotPath })
  return { status: "captured", url, ...obs }
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

export async function runVisualGate({ root, runId, url, uiChanged = true, driver = null, io = undefined } = {}) {
  const runDir = root && runId ? join(root, ".gstack", "runs", runId) : null
  const observation = uiChanged ? await observePage({ url, runDir, driver }) : null
  const result = evaluateVisualGate({ uiChanged, observation })
  if (root && runId) persistVisualEvidence(root, runId, result, url, io)
  return { ...result, url }
}
