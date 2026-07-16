#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildCleanMachineReport } from "../src/installer/clean-machine-pack.js"

/**
 * CLEAN-MACHINE TEST PACK (PRD42 S42.13) — `npm run test:cleanmachine`.
 *
 * Simula a jornada REAL do usuário final SEM setup prévio do mantenedor e consolida o veredito
 * em `gstack.cleanmachine.v1` (status POR CAPACIDADE e POR PLATAFORMA). NÃO reimplementa: COMPÕE
 * os provadores existentes — `test:e2e:package` (tarball → prefixo isolado → create/build/
 * uninstall byte-a-byte), `tools clean-machine --json` (invariantes offline: OpenCode sacred,
 * Lite sem escrita global, restore byte-a-byte, matriz de tools) e `proof --profile full` (o
 * carimbo determinístico). Backends (Casdoor/Atomic/AgentMemory/OpenHands) sem engine local =
 * `blocked_missing_engine` — NUNCA verde falso. Relatório em .gstack/reports/cleanmachine.json.
 *
 * Config: GSTACK_CM_SKIP_PACKAGE=1 pula o lifecycle de tarball (rápido, p/ smoke do agregador).
 */

const isWin = process.platform === "win32"
const REPORT_DIR = join(".gstack", "reports")

// npm no Windows é shim .cmd → precisa de cmd.exe /c.
function npmRun(script, { timeoutMs = 900000 } = {}) {
  const file = isWin ? process.env.ComSpec || "cmd.exe" : "npm"
  const args = isWin ? ["/c", "npm", "run", script] : ["run", script]
  return spawnSync(file, args, { encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], shell: false })
}
function cli(args, { timeoutMs = 300000 } = {}) {
  return spawnSync(process.execPath, ["src/index.js", ...args], { encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], shell: false })
}
const parseJson = (r) => { try { return JSON.parse(String(r.stdout || "").trim()) } catch { return null } }
const journeyStatus = (r) => ((r.status || 0) === 0 ? "passed" : "failed")

// ── jornadas (cada uma: { id, run } → { id, status, detail }) ────────────────────
function runPackageLifecycle() {
  if (process.env.GSTACK_CM_SKIP_PACKAGE === "1") return { id: "package-lifecycle", status: "not_run", detail: "GSTACK_CM_SKIP_PACKAGE=1" }
  const r = npmRun("test:e2e:package", { timeoutMs: 900000 })
  return { id: "package-lifecycle", status: journeyStatus(r), detail: journeyStatus(r) === "passed" ? "tarball → prefixo isolado → create/build/uninstall" : `exit ${r.status}` }
}
function runOfflineInvariants() {
  const r = cli(["tools", "clean-machine", "--json"])
  const j = parseJson(r)
  const ok = !!j && j.ok === true
  return { id: "offline-invariants", status: ok ? "passed" : "failed", detail: j ? `${j.passed}/${j.total} cenários` : `exit ${r.status}` }
}
function runProofFull() {
  const r = cli(["proof", "--profile", "full", "--explain", "--json"], { timeoutMs: 1800000 })
  const p = parseJson(r)
  const ok = !!p && p.ready === true
  return { id: "proof-full", status: ok ? "passed" : "failed", detail: p ? `ready=${p.ready} blockers=${(p.blockers || []).length}` : `exit ${r.status}` }
}
function runDreamBehavioral() {
  const r = cli(["dream", "audit", "--json"])
  const d = parseJson(r)
  const s = d && d.summary
  const ok = !!s && s.RISK === 0 && s.PLACEBO === 0
  return { id: "dream-behavioral", status: ok ? "passed" : "failed", detail: s ? `RISK=${s.RISK} PLACEBO=${s.PLACEBO}` : `exit ${r.status}` }
}

const JOURNEYS = [runPackageLifecycle, runOfflineInvariants, runProofFull, runDreamBehavioral]

// ── capacidades: backends locais sem engine ⇒ blocked_missing_engine (honesto) ───
function dockerAvailable() {
  const r = spawnSync("docker", ["info"], { encoding: "utf-8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"], shell: false })
  return (r.status || 0) === 0
}
const dockerCmd = (args, timeout = 180000) =>
  spawnSync("docker", args, { encoding: "utf-8", timeout, stdio: ["ignore", "pipe", "pipe"], shell: false })
const curlBin = () => (isWin ? "curl.exe" : "curl")
const httpCode = (url) => {
  const r = spawnSync(curlBin(), ["-s", "-o", isWin ? "NUL" : "/dev/null", "-w", "%{http_code}", "--max-time", "5", url],
    { encoding: "utf-8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"], shell: false })
  return String(r.stdout || "").trim()
}
const httpBody = (url, body) => {
  const r = spawnSync(curlBin(), ["-s", "--max-time", "15", "-X", "POST", url, "-H", "Content-Type: application/json", "-d", body],
    { encoding: "utf-8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"], shell: false })
  try { return JSON.parse(String(r.stdout || "")) } catch { return null }
}

/**
 * PRD45 S45.0 — E2E REAL de RBAC do Casdoor. Antes esta capacidade era `passed` só porque
 * `docker info` respondia: daemon de pé não prova IAM nenhum (ficou "passed" durante todo o
 * período em que o Casdoor crash-loopava e sequer subia). Aqui subimos o compose GERADO PELO
 * PRÓPRIO create e exigimos prova comportamental com controle negativo:
 *   (a) não-autenticado é NEGADO ("Please login first") — sem isso "RBAC" não significa nada;
 *   (b) credencial válida é ACEITA (built-in/admin) — senão estaríamos "provando" um IAM morto.
 * Teardown sempre (inclusive em exceção); volume junto (-v) p/ não vazar DB entre execuções.
 */
const CASDOOR_CM_NAME = "casdoor-cleanmachine"
const CASDOOR_CM_URL = "http://127.0.0.1:8000"

async function writeCasdoorFixture(dir) {
  const { casdoorComposeYaml, casdoorAppConf, CASDOOR_APP_CONF_FILE } = await import("../src/cli/create.js")
  writeFileSync(join(dir, "docker-compose.yml"), casdoorComposeYaml(CASDOOR_CM_NAME))
  writeFileSync(join(dir, CASDOOR_APP_CONF_FILE), casdoorAppConf())
}
function casdoorDown(composeFile) {
  dockerCmd(["compose", "-f", composeFile, "down", "-v"], 90000)
  dockerCmd(["rm", "-f", CASDOOR_CM_NAME], 30000)
}
async function bootCasdoorForE2E(composeFile) {
  const { casdoorHealthy } = await import("../src/cli/create.js")
  const up = dockerCmd(["compose", "-f", composeFile, "up", "-d"], 180000)
  if ((up.status || 0) !== 0) return `compose up falhou: ${String(up.stderr || "").slice(0, 120)}`
  // Primeiro boot cria o schema SQLite — pode levar ~1min.
  if (!casdoorHealthy(CASDOOR_CM_URL, undefined, { attempts: 40, delayMs: 3000 })) return "Casdoor subiu mas nunca respondeu ao health check"
  return null
}
async function runCasdoorRbacE2E() {
  const { mkdtempSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const dir = mkdtempSync(join(tmpdir(), "gstack-cm-casdoor-"))
  const composeFile = join(dir, "docker-compose.yml")
  try {
    await writeCasdoorFixture(dir)
    casdoorDown(composeFile) // limpa resto de execução anterior
    const bootErr = await bootCasdoorForE2E(composeFile)
    if (bootErr) return { status: "failed", reason: bootErr }
    return casdoorRbacVerdict()
  } catch (e) {
    return { status: "failed", reason: `E2E Casdoor quebrou: ${String(e.message || e).slice(0, 120)}` }
  } finally {
    casdoorDown(composeFile)
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}
// (a) CONTROLE NEGATIVO: sem sessão, a API tem que RECUSAR. @returns erro ou null.
const anonMessage = (r) => String(r.msg || r.data || "")
function rbacDeniesAnon() {
  const anon = httpBody(`${CASDOOR_CM_URL}/api/get-account`, "{}")
  if (!anon) return "RBAC: /api/get-account não respondeu JSON"
  if (anon.status === "error" && /login/i.test(anonMessage(anon))) return null
  return `RBAC não negou anônimo (resposta: ${JSON.stringify(anon).slice(0, 80)})`
}
// (b) credencial válida tem que ser ACEITA — senão um IAM que nega TUDO passaria como RBAC.
function rbacAcceptsValid() {
  const login = httpBody(`${CASDOOR_CM_URL}/api/login`,
    JSON.stringify({ application: "app-built-in", organization: "built-in", username: "admin", password: "123", autoSignin: true, type: "login" }))
  if (login && login.status === "ok") return null
  return `credencial válida recusada (IAM não funcional): ${JSON.stringify(login).slice(0, 80)}`
}
const uiResponds = () => (httpCode(`${CASDOOR_CM_URL}/`) === "200" ? null : "UI do Casdoor não responde 200")

function casdoorRbacVerdict() {
  const failure = rbacDeniesAnon() || rbacAcceptsValid() || uiResponds()
  if (failure) return { status: "failed", reason: failure }
  return { status: "passed", reason: "E2E real: anônimo NEGADO + credencial válida ACEITA (built-in/admin) + UI 200" }
}

async function capabilities(offlineOk) {
  const engineUp = dockerAvailable()
  // PRD45 S45.0: engine presente ≠ capacidade provada. Sem E2E real ⇒ `not_proved`
  // (nunca `passed`). Os E2E de atomic-merge/agentmemory-persist são do S45.8; até lá o
  // pack DECLARA que não provou, em vez de fingir que provou.
  const unproven = (id, why) => ({
    id, required: true, platformSupport: { win32: "supported", darwin: "supported", linux: "supported" },
    result: engineUp
      ? { status: "not_proved", reason: `engine disponível, mas SEM E2E real aqui (${why})` }
      : { status: "blocked_missing_engine", reason: "docker daemon ausente — E2E roda em job de CI" },
  })
  const casdoor = {
    id: "casdoor-rbac", required: true, platformSupport: { win32: "supported", darwin: "supported", linux: "supported" },
    result: engineUp ? await runCasdoorRbacE2E() : { status: "blocked_missing_engine", reason: "docker daemon ausente — E2E roda em job de CI" },
  }
  return [
    { id: "lite-no-global-leak", required: true, platformSupport: { win32: "supported", darwin: "supported", linux: "supported" }, result: { status: offlineOk ? "passed" : "failed", reason: "Lite não vaza Casdoor/Headroom/OpenHands nem escreve global" } },
    { id: "opencode-config-sacred", required: true, platformSupport: { win32: "supported", darwin: "supported", linux: "supported" }, result: { status: offlineOk ? "passed" : "failed", reason: "config OpenCode read-only byte-a-byte" } },
    casdoor,
    unproven("atomic-merge", "E2E de merge concorrente: S45.8"),
    unproven("agentmemory-persist", "E2E write→restart→search: S45.8"),
    { id: "openhands-sandbox", required: false, platformSupport: { win32: "unsupported", darwin: "wsl_only", linux: "supported" },
      result: engineUp ? { status: "not_proved", reason: "engine disponível, mas SEM E2E de sandbox aqui (S45.8)" } : { status: "blocked_missing_engine", reason: "docker daemon ausente — E2E roda em job de CI" } },
  ]
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log("═══ CLEAN-MACHINE TEST PACK — gstack_vibehard ═══\n")
const journeys = JOURNEYS.map((fn) => {
  process.stdout.write(`▸ ${fn.name} ... `)
  const j = fn()
  console.log(`${j.status.toUpperCase()}${j.detail ? ` — ${j.detail}` : ""}`)
  return j
})
const offlineOk = journeys.find((j) => j.id === "offline-invariants")?.status === "passed"
// E2E de backend roda Docker REAL (sobe/derruba container) — daí o await.
const report = buildCleanMachineReport({ platform: process.platform, capabilities: await capabilities(offlineOk), journeys })

console.log("\n═══ CAPACIDADES ═══")
for (const c of report.capabilities) console.log(`  ${c.status === "passed" ? "✓" : c.status === "not_applicable" ? "–" : "✗"} ${c.id}: ${c.status}${c.reason ? ` (${c.reason})` : ""}`)
console.log(`\nVEREDITO: ${report.verdict}  ·  plataforma: ${report.platform}`)
console.log(`jornadas ${report.summary.journeys.passed}/${report.summary.journeys.total} · caps passed=${report.summary.capabilities.passed} not_proved=${report.summary.capabilities.notProved} blocked=${report.summary.capabilities.blockedMissingEngine} n/a=${report.summary.capabilities.notApplicable}`)

try {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(join(REPORT_DIR, "cleanmachine.json"), JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, ...report }, null, 2) + "\n")
  console.log(`\nRelatório: ${join(REPORT_DIR, "cleanmachine.json")}`)
} catch { /* best-effort */ }

// Exit 0 em ready OU ready_engines_blocked (parcial honesto sem engine local).
// not_ready/incomplete = falha real (jornada quebrada ou não rodada).
// PRD45 S45.0: `capabilities_unproven` sai 1 — COM engine e sem E2E, quem não provou fomos
// nós. Sair 0 aqui era o falso-verde que deixava "passed" um backend em crash-loop.
process.exit(["ready", "ready_engines_blocked"].includes(report.verdict) ? 0 : 1)
