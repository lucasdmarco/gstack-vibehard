#!/usr/bin/env node
/**
 * PRD47 S47.9 — Golden Workflow vertical `saas-auth-stripe`: prova UMA trilha
 * completa REAL antes de generalizar (47.10). Fora do `npm test` padrão (como
 * `test:pack`/`test:golden`/`test:templates`) porque faz instalação de pacote e
 * sobe processo real — pesado demais para rodar em todo `npm test`.
 *
 * Escopo HONESTO desta máquina/sessão (Windows, sem credencial real de
 * Stripe/Supabase, sem runners macOS/Linux disponíveis): prova o núcleo OFFLINE
 * do vertical — scaffold real, deps reais (apps/api, leve — sem Next.js), runtime
 * real, falha semeada real -> repair loop real (S47.4) -> checkpoint/rollback
 * real (S41.7) -> recovery real -> Context Delta real (S47.7). Stripe/Supabase
 * ficam `blocked` por design (nunca "verde" sem credencial real — DoD linha 6).
 * `panel_observed_browser`/multi-SO/5-execuções-frias ficam `not_executed` —
 * declarado, nunca fingido (mesma disciplina de "partial honesto" do programa).
 */
import { execFileSync, spawn } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bin = join(repoRoot, "src", "index.js")
const isWin = process.platform === "win32"
let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.error(`  ✗ ${m}`); failures++ }
const imp = (rel) => import(pathToFileURL(join(repoRoot, rel)).href)

function node(args, opts = {}) {
  return execFileSync(process.execPath, args, { encoding: "utf-8", stdio: "pipe", timeout: 60000, ...opts })
}
// pnpm via cmd.exe no Windows (.cmd shim dá EINVAL no execFileSync direto — mesma lição do test-pack.mjs).
function pnpm(args, opts = {}) {
  const base = { encoding: "utf-8", stdio: "pipe", timeout: 240000, ...opts }
  return isWin ? execFileSync("cmd.exe", ["/c", "pnpm", ...args], base) : execFileSync("pnpm", args, base)
}
function spawnTsx(cwd, env) {
  return isWin
    ? spawn("cmd.exe", ["/c", "pnpm", "exec", "tsx", "src/index.ts"], { cwd, env, stdio: "pipe" })
    : spawn("pnpm", ["exec", "tsx", "src/index.ts"], { cwd, env, stdio: "pipe" })
}

async function killTree(proc) {
  if (!proc || !proc.pid) return
  const { killTreeCommand } = await imp("src/runtime/supervisor.js")
  const { file, args } = killTreeCommand(proc.pid, process.platform)
  try { execFileSync(file, args, { stdio: "pipe", timeout: 10000 }) } catch { /* já morto */ }
}

async function waitForHttp(port, pathname, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(1500) })
      return { ok: true, status: res.status, json: await res.json().catch(() => null) }
    } catch (e) { lastError = e; await new Promise((r) => setTimeout(r, 300)) }
  }
  return { ok: false, error: lastError ? lastError.message : "timeout" }
}

console.log("== Golden Workflow vertical: saas-auth-stripe (E2E real, Windows) ==")
const work = mkdtempSync(join(tmpdir(), "gstack-vertical-"))
const projectDir = join(work, "verticalapp")
const apiDir = join(projectDir, "apps", "api")
const indexTs = join(apiDir, "src", "index.ts")
const port = 3987
let apiProc = null
const evidenceById = new Map()
const { evidenceItem } = await imp("src/project-plan/golden-workflow-vertical.js")
// idempotente por id (a última chamada vence) — evita duplicata mentirosa no relatório final.
const record = (id, status, detail = null) => { evidenceById.set(id, evidenceItem(id, status, detail)); return status === "proved" }

// LEITURA apenas — prova real que nada tocou o manifest global do usuário (~/.gstack_vibehard).
async function manifestHash() {
  const { manifestPath } = await imp("src/installer/manifest.js")
  const p = manifestPath()
  return existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null
}

try {
  const manifestBefore = await manifestHash()

  // 1) scaffold REAL do template
  const created = node([bin, "create", "verticalapp", "--template", "saas-auth-stripe", "--lite"], { cwd: work })
  const scaffoldOk = existsSync(indexTs) && existsSync(join(projectDir, ".env.example"))
  if (scaffoldOk) ok("scaffold real do template saas-auth-stripe criado")
  else { bad(`scaffold falhou: ${created.slice(0, 200)}`); throw new Error("scaffold_failed") }

  // brief/design direction — persistidos pelo pipeline wizard/start real (fora do escopo runtime
  // desta prova; já cobertos com evidência real por tests/start_wizard.test.js e
  // tests/design_direction.test.js — declarado aqui, não reprovado).
  record("brief_persisted", "not_executed", "escopo desta prova é o runtime, não o wizard interativo (já coberto por tests/start_wizard.test.js)")
  record("design_direction", "not_executed", "coberto por tests/design_direction.test.js — fora do escopo runtime desta prova")

  // 2) credential gate REAL contra o .env.example gerado — nunca "verde" sem credencial real
  const { stripeGate, supabaseGate } = await imp("src/project-plan/golden-workflow-vertical.js")
  const envExample = readFileSync(join(projectDir, ".env.example"), "utf-8")
  const env = Object.fromEntries(envExample.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)] }))
  const stripe = stripeGate(env)
  const supabase = supabaseGate(env)
  if (stripe.status === "blocked" && supabase.status === "blocked") ok("Stripe/Supabase: blocked por design (placeholders do scaffold, nunca credencial real)")
  else bad(`credential gate deveria bloquear placeholders: stripe=${stripe.status} supabase=${supabase.status}`)
  record("login_exercised", "blocked", "depende de Supabase real — nunca simulado")
  record("stripe_test_mode", "blocked", "sem credencial real nesta sessão — DoD linha 6: nunca verde sem ela")
  record("panel_observed_browser", "not_executed", "Next.js/apps/web fora do escopo desta prova (peso de install alto); apps/api provado por completo")
  record("console_network_a11y_clean", "not_executed", "depende de painel no browser (item acima)")
  record("unhappy_path", "not_executed", "depende de login/painel reais")

  // 3) deps REAIS — só apps/api (leve, sem Next.js): prova instalação real
  pnpm(["install"], { cwd: apiDir })
  const depsOk = existsSync(join(apiDir, "node_modules", "tsx"))
  record("scaffold_deps_installed", depsOk ? "proved" : "blocked")
  if (depsOk) ok("pnpm install REAL em apps/api (tsx/typescript/@supabase/stripe/zod)")
  else { bad("pnpm install não materializou node_modules/tsx"); throw new Error("install_failed") }

  // 4) runtime REAL — sobe o processo de verdade, health check real
  const runEnv = { ...process.env, API_PORT: String(port) }
  apiProc = spawnTsx(apiDir, runEnv)
  const health1 = await waitForHttp(port, "/health", 25000)
  const runtimeOk = health1.ok && health1.json && health1.json.status === "ok"
  record("runtime_started", runtimeOk ? "proved" : "blocked", health1)
  if (runtimeOk) ok(`runtime REAL respondendo em :${port}/health -> ${JSON.stringify(health1.json)}`)
  else { bad(`runtime real não respondeu: ${JSON.stringify(health1)}`); throw new Error("runtime_failed") }

  // 5) checkpoint VERDE real antes de semear a falha
  const { createCheckpoint, rollbackToLastGreen } = await imp("src/skills/loop-checkpoint.js")
  const runId = "vertical-e2e-run"
  const original = readFileSync(indexTs, "utf-8")
  const ckpt = createCheckpoint({ root: projectDir, runId, files: ["apps/api/src/index.ts"], green: true, note: "runtime saudável antes da falha semeada" })
  if (ckpt.ok) ok(`checkpoint real criado (seq=${ckpt.seq}, green)`)
  else bad(`checkpoint real falhou: ${ckpt.reason}`)

  // 6) falha REAL semeada — health endpoint passa a responder ERRADO (não crash total,
  //    p/ exercitar o ciclo diagnose/repair de verdade, não só reachable:false)
  await killTree(apiProc); apiProc = null
  const broken = original.replace('{ status: \'ok\' }', '{ status: \'degraded\' }')
  writeFileSync(indexTs, broken)
  apiProc = spawnTsx(apiDir, runEnv)
  const health2 = await waitForHttp(port, "/health", 25000)
  const seededOk = health2.ok && health2.json && health2.json.status !== "ok"
  if (seededOk) ok(`falha semeada REAL confirmada: /health -> ${JSON.stringify(health2.json)}`)
  else bad(`falha semeada não observada como esperado: ${JSON.stringify(health2)}`)

  // 7) repair loop REAL (S47.4): evaluateRepairCycle decide a partir do health REAL observado
  const { evaluateRepairCycle, restoreLastGreen } = await imp("src/project-plan/runtime-repair-cycle.js")
  const { buildLoopState } = await imp("src/skills/replit-loop.js")
  const loopState = buildLoopState({ runId, intent: "runtime-repair", acceptance: ["health_ok"], budget: { maxIterations: 3 } })
  const healthResults = [{ service: "api", reachable: true, healthy: health2.json?.status === "ok" }]
  const observation = { visualValidated: false, problems: [`health respondeu status=${health2.json?.status}`], checks: { health_ok: false } }
  const decision = evaluateRepairCycle({ healthResults, uiChanged: false, observation, acceptance: ["health_ok"], loopState })
  const repairOk = decision.action === "autocorrect" && Array.isArray(decision.restart) && decision.restart.includes("api")
  record("repair_loop_proved", repairOk ? "proved" : "blocked", decision)
  if (repairOk) ok(`runtime-repair-cycle.js decidiu REAL: action=${decision.action} restart=${JSON.stringify(decision.restart)}`)
  else bad(`repair cycle não decidiu como esperado: ${JSON.stringify(decision)}`)

  // 8) rollback REAL (restoreLastGreen = o PRÓPRIO repair cycle usa loop-checkpoint.js)
  await killTree(apiProc); apiProc = null
  const rb = restoreLastGreen({ root: projectDir, runId })
  const restoredContent = existsSync(indexTs) ? readFileSync(indexTs, "utf-8") : null
  const rollbackOk = rb.ok && restoredContent === original
  record("rollback_to_green", rollbackOk ? "proved" : "blocked", { ok: rb.ok, seq: rb.seq })
  if (rollbackOk) ok(`rollback REAL restaurou o arquivo exatamente ao estado verde (checkpoint seq=${rb.seq})`)
  else bad(`rollback falhou ou não restaurou o conteúdo original: ${JSON.stringify(rb)}`)

  // 9) recovery REAL pós-rollback — mesma disciplina de "nunca presume, sempre prova"
  apiProc = spawnTsx(apiDir, runEnv)
  const health3 = await waitForHttp(port, "/health", 25000)
  const recoveredOk = health3.ok && health3.json && health3.json.status === "ok"
  const verifyOk = recoveredOk
  record("verify_proof_acceptance", verifyOk ? "proved" : "blocked", health3)
  if (recoveredOk) ok(`recovery REAL confirmada pós-rollback: /health -> ${JSON.stringify(health3.json)}`)
  else bad(`recovery não confirmada: ${JSON.stringify(health3)}`)

  // 10) Context Delta REAL a partir do checkpoint/rollback desta execução — resume sem reler o repo
  const { buildContextDelta, resolveContextDeltaLoad } = await imp("src/project-plan/context-delta.js")
  const delta = buildContextDelta({
    checkpoint: { seq: rb.seq, hash: ckpt.files[0]?.sha256, green: true },
    diagnosis: { code: decision.verdict, summary: decision.reason },
    nextAction: "recovered_via_rollback",
    touchedFiles: ["apps/api/src/index.ts"],
  })
  const load = resolveContextDeltaLoad(delta, { graphState: "fresh" })
  const deltaOk = delta.checkpoint.green === true && load.action === "reuse"
  record("resume_via_context_delta", deltaOk ? "proved" : "blocked", { delta, load })
  if (deltaOk) ok("Context Delta REAL construído a partir do run — resume sem reler o repositório")
  else bad("Context Delta não capturou o estado esperado")

  // 11) prova REAL (não presumida) de que o manifest global do usuário não foi tocado
  const manifestAfter = await manifestHash()
  const noGlobalWrites = manifestAfter === manifestBefore
  record("no_global_writes", noGlobalWrites ? "proved" : "blocked", { before: manifestBefore, after: manifestAfter })
  if (noGlobalWrites) ok("manifest global do usuário (~/.gstack_vibehard) hash IDÊNTICO antes/depois — nada tocado")
  else bad(`manifest global MUDOU durante a prova: before=${manifestBefore} after=${manifestAfter}`)

  const { buildVerticalReport } = await imp("src/project-plan/golden-workflow-vertical.js")
  const report = buildVerticalReport([...evidenceById.values()])
  console.log(`\n  relatório: overall=${report.overall} missing=${JSON.stringify(report.missing)} notProved=${JSON.stringify(report.notProved)}`)

  // Persiste no PRÓPRIO repo (não no tmp) — publish-guard.js (S47.10) lê daqui pra
  // exigir as evidências CORE do Golden Workflow antes de publicar.
  const reportsDir = join(repoRoot, ".gstack", "reports")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(reportsDir, { recursive: true })
  writeFileSync(join(reportsDir, "vertical.json"), JSON.stringify({ ...report, ranAt: new Date().toISOString(), platform: process.platform }, null, 2) + "\n")
  ok(`relatório persistido em .gstack/reports/vertical.json`)
} catch (e) {
  bad(`erro fatal: ${e.message}`)
} finally {
  await killTree(apiProc)
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* cleanup */ }
}

if (failures > 0) { console.error(`\nvertical saas-auth-stripe: ${failures} falha(s)`); process.exit(1) }
console.log("\nvertical saas-auth-stripe: OK (núcleo offline real provado; Stripe/Supabase/painel-browser/multi-SO declarados not_executed/blocked por falta de credencial/ambiente)")
