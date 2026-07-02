import { existsSync, readdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { execFileSync, execFile } from "child_process"
import { getHarness, isWindows, isMacOS, getOSLabel } from "../harness/detector.js"
import { checkAlreadyInstalled } from "./check.js"
import { npxArgv } from "./deps.js"
import { detectHarnesses } from "../harness/detector.js"
import { inspectOpenCodeConfig } from "../harness/opencode-config.js"
import { checkInstallIntegrity } from "./integrity.js"
import { repairManifest } from "./repair-manifest.js"
import { resolvePackageManager } from "./package-manager.js"
import { npmArgv } from "./deps.js"
import { buildInstallImpact } from "./impact.js"
import { planOpenCodeFix, applyOpenCodeFix } from "./opencode-jsonc.js"
import { section, success, warn, error, info, confirm } from "../cli/index.js"

const HOME = homedir()

// readdir EPERM/EACCES-safe: null = não deu p/ ler (permissão/ausente), nunca crash.
function safeReaddir(dir) { try { return readdirSync(dir) } catch { return null } }
function toolVer(cmd, args = ["--version"]) {
  try { return String(execFileSync(cmd, args, { encoding: "utf-8", stdio: "pipe", timeout: 4000 })).trim() } catch { return null }
}

/**
 * Coletor estruturado do `doctor` (P0.7) — DETERMINÍSTICO e EPERM-safe. Não imprime
 * nada; retorna o objeto que o `--json` serializa puro. `ok=false` se um check
 * obrigatório falhar (Node/Python ausente, ou manifest com problema).
 */
export async function collectDoctorJson(home = HOME) {
  const warnings = []
  const node = toolVer("node")
  const python = toolVer("python") || toolVer("python3")
  const detected = detectHarnesses().map((h) => ({ id: h.id, label: h.label }))
  const gstackInstalled = checkAlreadyInstalled(detected.map((h) => h.id))
  const hooks = safeReaddir(join(home, ".codex", "hooks"))
  const skills = safeReaddir(join(home, ".agents", "skills"))
  const pwBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (isWindows() ? join(home, "AppData", "Local", "ms-playwright") : join(home, ".cache", "ms-playwright"))
  let chromium = false
  if (existsSync(pwBrowsers)) {
    const b = safeReaddir(pwBrowsers)
    if (b === null) warnings.push(`Playwright: sem permissão p/ ler ${pwBrowsers} (EPERM/EACCES)`)
    else chromium = b.some((f) => f.startsWith("chromium"))
  }
  const integrity = checkInstallIntegrity(home)
  const impact = buildInstallImpact({ home })
  const oc = inspectOpenCodeConfig(home)
  const okRequired = !!node && !!python && (integrity.manifestExists ? integrity.safeToUninstall : true)
  return {
    ok: okRequired,
    os: getOSLabel(),
    versions: { node, python },
    harnesses: { detected, gstackInstalled },
    components: {
      hooks: hooks ? hooks.filter((f) => f.endsWith(".py")).length : 0,
      skills: skills ? skills.length : 0,
    },
    mcpGlobal: existsSync(join(home, ".mcp.json")),
    opencode: { hasJson: oc.hasJson, hasJsonc: oc.hasJsonc, hasConflict: oc.hasConflict },
    playwright: { browsersPath: pwBrowsers, chromium },
    deps: { bun: !!toolVer("bun"), rust: !!toolVer("rustc"), gbrain: !!toolVer("gbrain"), graphify: !!toolVer("graphify"), headroom: !!toolVer("headroom") },
    integrity: { manifestExists: integrity.manifestExists, items: integrity.items, drift: integrity.drift, safeToUninstall: integrity.safeToUninstall, issues: integrity.issues },
    impactCategories: impact.map((c) => ({ category: c.category, items: c.items.length })),
    warnings,
  }
}

export async function doctor(args = []) {
  const json = args.includes("--json")
  const strict = args.includes("--strict")
  // `doctor --json` (diagnóstico completo) → JSON PURO. --strict → exit≠0 se check
  // obrigatório falhar. Não roteia aqui os modos --impact/--install-integrity (têm
  // seu próprio JSON abaixo) nem --fix (interativo).
  if (json && !args.includes("--impact") && !args.includes("--install-integrity") && !args.includes("--fix") && !args.includes("--repair-manifest") && !args.includes("--package-manager") && !args.includes("--pm")) {
    const report = await collectDoctorJson(HOME)
    process.stdout.write(JSON.stringify(report) + "\n")
    if (strict && !report.ok) process.exitCode = 1
    return
  }
  // Correção assistida do drift OpenCode (json + jsonc).
  if (args.includes("--fix")) {
    const dryRun = args.includes("--dry-run")
    section("doctor --fix — OpenCode config (opencode.json + opencode.jsonc)")
    const plan = planOpenCodeFix(HOME)
    if (plan.action === "none") { success("OpenCode: sem conflito json+jsonc — nada a corrigir."); return }
    if (plan.action === "manual") {
      warn("Conflito detectado, mas o parse automático falhou (ajuste manual):")
      warn(`  ${plan.parseError}`)
      return
    }
    info("Conflito: opencode.json + opencode.jsonc coexistem.")
    info(`  Plano: merge preservando o que é do usuário (${(plan.userKeysPreserved || []).join(", ") || "—"}) — OAuth/plugin/provider mantidos.`)
    info(`  → escreve o merge em ${plan.jsonPath}`)
    info("  → backup de AMBOS (.gstack_vibehard.bak); remove o .jsonc (preservado no backup)")
    if (dryRun) { info("(--dry-run: nada foi alterado)"); return }
    const ok = args.includes("--yes") || (process.stdin.isTTY && await confirm("Aplicar o merge agora?", false))
    if (!ok) { info("Cancelado (use --yes em modo não-interativo)."); return }
    const r = applyOpenCodeFix(HOME)
    if (r.applied) success("OpenCode: merge aplicado. Reabra o OpenCode e verifique provider/OAuth.")
    else warn("Não aplicado.")
    return
  }
  // Modo impacto: mostra quais componentes GLOBAIS estão ativos nesta máquina
  // (o que afeta QUALQUER projeto dos harnesses), por categoria.
  if (args.includes("--impact")) {
    if (json) { process.stdout.write(JSON.stringify(buildInstallImpact({ home: HOME })) + "\n"); return }
    section("doctor --impact — componentes globais ativos")
    const impact = buildInstallImpact({ home: HOME })
    for (const c of impact) {
      const present = c.items.filter((it) => it.action === "modify")
      if (c.category === "deps") continue
      if (present.length === 0) { info(`${c.label}: nenhum instalado`); continue }
      const tag = c.category === "mcp-global" || c.category === "harness-config"
        ? " — AFETA QUALQUER PROJETO deste harness/usuário" : ""
      warn(`${c.label}: ${present.length} ativo(s)${tag}`)
      for (const it of present) info(`  • ${it.path}`)
    }
    const ocPlugins = join(HOME, ".config", "opencode", "plugins")
    info("")
    info(existsSync(ocPlugins)
      ? "OpenCode plugins globais ATIVOS: carregam em qualquer sessão OpenCode deste usuário."
      : "OpenCode plugins globais: nenhum.")
    // Output Guard honesto (PRD14 §6.6): o guard padrão audita DEPOIS da resposta.
    // Prevenção em trânsito é opt-in via proxy — nunca prometida como universal.
    info("")
    info("Output Guard: pós-resposta (auditoria via hooks) — detecção, não prevenção.")
    info("  Redação EM TRÂNSITO (opt-in): `gstack_vibehard proxy` · estado: `gstack_vibehard proxy status`.")
    info("Rollback: `gstack_vibehard uninstall --dry-run` · Integridade: `--install-integrity`.")
    return
  }
  // Modo package-manager (PRD 12 PR2): resolve o PM do projeto e reporta estado +
  // reparo seguro. `--fix` instala o pnpm ausente (sem apagar lock/node_modules).
  if (args.includes("--package-manager") || args.includes("--pm")) {
    const cwd = process.cwd()
    const r = resolvePackageManager(cwd)
    if (json) {
      process.stdout.write(JSON.stringify(r) + "\n")
      if (strict && r.state !== "ok") process.exitCode = 1
      return
    }
    section("doctor --package-manager — resolver do gerenciador do projeto")
    const icon = r.state === "ok" ? "✓" : "⚠"
    info(`  ${icon} PM: ${r.pm} · estado: ${r.state}`)
    info(`    ${r.detail}`)
    if (r.state === "ok") { success("Package manager OK."); return }
    warn(`  Reparo: ${r.repair}`)
    if (args.includes("--fix") && r.state === "missing_binary" && r.pm === "pnpm") {
      const ok = args.includes("--yes") || (process.stdin.isTTY && await confirm("Instalar o pnpm agora (`npm install -g pnpm`)?", false))
      if (!ok) { info("Cancelado (use --yes em modo não-interativo)."); return }
      try {
        const { file, argv } = npmArgv(["install", "-g", "pnpm"])
        execFileSync(file, argv, { stdio: "inherit", timeout: 120000 })
        success("pnpm instalado. Rode `doctor --package-manager` de novo p/ confirmar.")
      } catch (e) { warn(`Falha ao instalar pnpm: ${e.message}. Manual: npm install -g pnpm`) }
    } else if (args.includes("--fix")) {
      info("  (--fix não aplica reparo destrutivo automaticamente: lockfile/node_modules exigem sua confirmação manual — siga o passo acima.)")
    }
    return
  }

  // Modo reparo: limpa/migra um manifest inseguro SEM destruir backups do usuário.
  // Default = --dry-run (só mostra o plano); --yes aplica (faz backup do manifest).
  if (args.includes("--repair-manifest")) {
    const apply = args.includes("--yes") && !args.includes("--dry-run")
    const r = repairManifest(HOME, { dryRun: !apply })
    if (json) {
      process.stdout.write(JSON.stringify(r) + "\n")
      if (strict && r.manifestExists && r.mutating > 0 && !r.applied) process.exitCode = 1
      return
    }
    section("doctor --repair-manifest — limpeza/migração segura do manifest")
    if (!r.manifestExists) { warn(r.note); return }
    if (r.plan.length === 0) { success("Manifest íntegro — nada a reparar."); return }
    info(`${r.plan.length} item(ns) no plano (${r.mutating} mutação(ões); restante é só relato):`)
    for (const a of r.plan) {
      const tag = a.action === "prune" ? "PODAR" : a.action === "mark-unrestorable" ? "MARCAR não-restaurável"
        : a.action === "migrate" ? "MIGRAR schema" : "RELATAR"
      info(`  • [${tag}] ${a.path} — ${a.reason}`)
    }
    info("Backups do usuário são SEMPRE preservados (nunca apagados).")
    if (!apply) {
      info("(--dry-run: nada foi alterado) — para aplicar: `gstack_vibehard doctor --repair-manifest --yes`")
      return
    }
    if (r.applied) success(`Manifest reparado (${r.before.items} → ${r.after.items} itens). Backup do manifest: ${r.backup || "—"}`)
    else info("Nada a aplicar (apenas relatos).")
    return
  }

  // Modo integridade: valida manifest/backups/hashes/configs e se uninstall é seguro.
  if (args.includes("--install-integrity")) {
    const r = checkInstallIntegrity(HOME)
    if (json) { process.stdout.write(JSON.stringify(r) + "\n"); if (strict && r.manifestExists && !r.safeToUninstall) process.exitCode = 1; return }
    section("Integridade da Instalacao (manifest/backups/hashes)")
    if (!r.manifestExists) { warn("Manifest ausente — nada a verificar (instale com `gstack_vibehard install`)."); return }
    success(`Manifest presente — ${r.items} item(ns) registrados`)
    info(`Backups OK: ${r.backupsOk}`)
    if (r.drift > 0) warn(`Drift: ${r.drift} arquivo(s) alterado(s) desde a instalacao (editado por voce/outro)`)
    if (r.issues.length === 0) success("Sem problemas — uninstall seria SEGURO")
    else {
      error(`${r.issues.length} problema(s):`)
      r.issues.forEach((i) => warn(`  ${i}`))
      warn("Rode `gstack_vibehard uninstall --dry-run` para ver o plano de rollback.")
    }
    return
  }

  section("Diagnostico do Ambiente")

  info(`Sistema: ${getOSLabel()}`)

  // Version checks (parallel)
  const [nodeVer, pyVer] = await Promise.all([
    new Promise((r) => execFile("node", ["--version"], { timeout: 5000 }, (e, stdout) => r(e ? null : stdout.trim()))),
    new Promise((r) => {
      execFile("python", ["--version"], { timeout: 5000 }, (e, stdout) => {
        if (!e) return r(stdout.trim())
        execFile("python3", ["--version"], { timeout: 5000 }, (e2, stdout2) => r(e2 ? null : stdout2.trim()))
      })
    }),
  ])
  if (nodeVer) success(`Node.js: ${nodeVer}`)
  else error("Node.js: NAO ENCONTRADO")
  if (pyVer) success(`Python: ${pyVer}`)
  else warn("Python: NAO ENCONTRADO (necessario para hooks)")

  // Harnesses
  section("Harnesses Detectados")

  const codexConfig = join(HOME, ".codex", "config.toml")
  const codexHooks = join(HOME, ".codex", "hooks")
  if (existsSync(codexConfig) || existsSync(codexHooks)) {
    success("Codex CLI — detectado")
    info(`  Config: ${codexConfig}`)
    info(`  Hooks: ${codexHooks}`)
  } else {
    warn("Codex CLI — nao detectado")
  }

  const claudeSettings = join(HOME, ".claude", "settings.json")
  const claudeMd = join(HOME, "CLAUDE.md")
  if (existsSync(claudeSettings) || existsSync(claudeMd)) {
    success("Claude Code — detectado")
    info(`  Settings: ${claudeSettings}`)
    if (existsSync(claudeMd)) info("  CLAUDE.md: presente")
  } else {
    warn("Claude Code — nao detectado")
  }

  const oc = inspectOpenCodeConfig(HOME)
  if (oc.hasJson || oc.hasJsonc) {
    success("OpenCode CLI — detectado")
    if (oc.hasJson) info(`  Config JSON:  ${oc.jsonPath}`)
    if (oc.hasJsonc) info(`  Config JSONC: ${oc.jsoncPath}`)
    if (oc.hasConflict) {
      warn("  Conflito: opencode.json E opencode.jsonc coexistem (config SUA, pre-existente).")
      warn("  Pode sombrear plugins/OAuth do Desktop. O gstack NAO altera esses arquivos.")
      info("  Remedio em 1 comando (com o OpenCode fechado): `gstack_vibehard doctor --fix`")
      info("    → merge assistido preservando OAuth/provider/plugins, com backup de ambos. `--dry-run` mostra o plano.")
    }
    const ocPlugins = join(HOME, ".config", "opencode", "plugins")
    const gstackPlugins = ["gstack-security.js", "gstack-session.js", "gstack-prompt.js"]
      .filter((f) => existsSync(join(ocPlugins, f)))
    if (gstackPlugins.length > 0) success(`  Plugins gstack: ${gstackPlugins.length} (auto-load)`)
    else info("  Plugins gstack: nenhum (rode `gstack_vibehard install`)")
  } else {
    try {
      const ver = execFileSync("opencode", ["--version"], { encoding: "utf-8", timeout: 3000 }).trim()
      success(`OpenCode CLI — detectado (v${ver}, sem config — integracao por plugins/skills)`)
    } catch {
      warn("OpenCode CLI — nao detectado")
    }
  }

  // Todos os harnesses detectados (inclui Cursor, Windsurf, Gemini, Kiro, Zed,
  // Copilot CLI, Droid, KiloCLI, Kimi, VS Code) com nivel de integracao
  const detected = detectHarnesses()
  const HOOKS_HARNESSES = new Set(["claude", "cursor", "opencode"])
  const otherDetected = detected.filter((h) => !["codex", "claude", "opencode"].includes(h.id))
  if (otherDetected.length > 0) {
    info("Outros harnesses detectados:")
    for (const h of otherDetected) {
      const level = HOOKS_HARNESSES.has(h.id)
        ? "hooks reais"
        : (h.instructionFile ? "instrucional" : "deteccao apenas")
      info(`  ${h.label} — ${level}`)
    }
  }

  // gstack_vibehard status per harness
  const ids = detected.map((h) => h.id)
  const gstackInstalled = checkAlreadyInstalled(ids)
  if (gstackInstalled.length > 0) {
    success(`gstack_vibehard instalado: ${gstackInstalled.join(", ")}`)
  } else {
    info("gstack_vibehard: nao instalado em nenhum harness")
  }

  // gstack_vibehard components
  section("Componentes gstack_vibehard")

  const hooks = join(HOME, ".codex", "hooks")
  if (existsSync(hooks)) {
    const fs = await import("fs")
    const hookFiles = fs.readdirSync(hooks).filter((f) => f.endsWith(".py"))
    success(`${hookFiles.length} hooks Python instalados`)
    info(`  ${hookFiles.join(", ")}`)
  } else {
    warn("Nenhum hook gstack_vibehard instalado")
  }

  const skillsDir = join(HOME, ".agents", "skills")
  if (existsSync(skillsDir)) {
    const fs = await import("fs")
    const skills = fs.readdirSync(skillsDir).filter((f) => f !== "." && f !== "..")
    success(`${skills.length} skills instaladas`)
  } else {
    warn("Nenhuma skill gstack_vibehard instalada")
  }

  const chronicleDir = (() => {
    const primary = join(HOME, ".gstack", "chronicle")
    if (existsSync(primary)) return primary
    return join(HOME, ".codex", "chronicle")
  })()
  if (existsSync(chronicleDir)) {
    const fs = await import("fs")
    const sessions = fs.readdirSync(chronicleDir).filter((f) => f.endsWith(".md"))
    success(`Chronicle: ${sessions.length} sessoes registradas`)
  } else {
    info("Chronicle: nenhuma sessao (primeira sessao cria)")
  }

  // Scripts
  const scriptsDir2 = join(HOME, ".agents", "scripts")
  if (existsSync(scriptsDir2)) {
    const fs = await import("fs")
    const scripts = fs.readdirSync(scriptsDir2).filter((f) => f.endsWith(".ps1"))
    success(`${scripts.length} setup scripts em ~/.agents/scripts/`)
  } else {
    info("Setup scripts: nao instalados")
  }

  // MCP
  section("MCP Servers")
  const mcp = join(HOME, ".mcp.json")
  if (existsSync(mcp)) {
    success(".mcp.json presente")
  } else {
    info(".mcp.json: nao configurado")
  }

  // Integracoes — dupla via (Composio nuvem + Printing Press local)
  section("Integracoes (Composio + Printing Press)")
  // Composio (nuvem): auth/escrita
  const composioEnv = process.env.COMPOSIO_API_KEY || process.env.COMPOSIO_TOKEN
  let composioCli = false
  try { execFileSync("composio", ["--version"], { stdio: "pipe", timeout: 3000 }); composioCli = true } catch { /* opcional */ }
  if (composioEnv) success("Composio (nuvem): token presente — escrita/OAuth disponivel")
  else if (composioCli) info("Composio (nuvem): CLI presente, sem token (rode `composio login`)")
  else info("Composio (nuvem): nao configurado (opcional — para acoes de escrita/OAuth)")
  // Printing Press (local): leitura/cauda-longa
  let goOk = false
  try { execFileSync("go", ["version"], { stdio: "pipe", timeout: 3000 }); goOk = true } catch { /* opcional */ }
  if (goOk) success("Printing Press (local): Go presente — `tools install` disponivel")
  else info("Printing Press (local): Go ausente — discovery funciona; `tools install` instala Go sob demanda")
  info("Por projeto: veja .gstack/integrations.json e `gstack_vibehard tools`")

  // Playwright
  section("Playwright (browser testing)")
  const pwBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (isWindows()
      ? join(HOME, "AppData", "Local", "ms-playwright")
      : join(HOME, ".cache", "ms-playwright"))
  try {
    const pwd = npxArgv(["playwright", "--version"])
    const pwVer = execFileSync(pwd.file, pwd.argv, { encoding: "utf-8", stdio: "pipe", timeout: 10000 }).trim()
    success(`Playwright CLI: ${pwVer}`)
  } catch {
    warn("Playwright CLI: nao disponivel (rode: npx playwright install chromium)")
  }
  if (existsSync(pwBrowsers)) {
    const entries = safeReaddir(pwBrowsers)
    if (entries === null) {
      warn(`Playwright: sem permissao p/ ler ${pwBrowsers} (EPERM) — ignorado, sem crash`)
    } else {
      const browsers = entries.filter((f) => f.startsWith("chromium"))
      if (browsers.length > 0) success(`Playwright: chromium instalado (${browsers.join(", ")})`)
      else warn("Playwright: chromium nao encontrado. Rode: npx playwright install chromium")
    }
  } else {
    warn("Playwright: browsers nao instalados. Rode: npx playwright install chromium")
  }

  // Dependencias globais
  section("Dependencias Globais")
  const missingDeps = []

  try {
    const bunVer = execFileSync("bun", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`bun: ${bunVer}`)
  } catch { warn("bun: nao instalado"); missingDeps.push("bun + gbrain") }

  try {
    const gbrainVer = execFileSync("gbrain", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`gbrain: ${gbrainVer}`)
  } catch { warn("gbrain: nao instalado") }

  try {
    const graphifyVer = execFileSync("graphify", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`graphify: ${graphifyVer}`)
  } catch { warn("graphify: nao instalado"); if (!missingDeps.includes("graphify")) missingDeps.push("graphify") }

  try {
    const rustVer = execFileSync("rustc", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`Rust: ${rustVer}`)
  } catch { warn("Rust: nao instalado"); missingDeps.push("Rust") }

  try {
    const headroomVer = execFileSync("headroom", ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim()
    success(`headroom: ${headroomVer}`)
  } catch { warn("headroom: nao instalado"); missingDeps.push("headroom") }

  if (isMacOS()) {
    try {
      execFileSync("which", ["mom"], { stdio: "pipe", timeout: 5000 })
      success("MOM: instalado")
    } catch { warn("MOM: nao instalado") }
  } else {
    info("MOM: apenas macOS")
  }

  // pytest — necessario para hooks Python, QG e Test Gate
  try {
    const pyBin = pyVer && pyVer.toLowerCase().includes("python 3") ? "python" : "python3"
    execFileSync(pyBin, ["-m", "pytest", "--version"], { stdio: "pipe", timeout: 5000 })
    success("pytest: instalado")
  } catch {
    try {
      execFileSync("python3", ["-m", "pytest", "--version"], { stdio: "pipe", timeout: 5000 })
      success("pytest: instalado")
    } catch { warn("pytest: nao instalado"); missingDeps.push("pytest") }
  }

  if (missingDeps.length > 0) {
    section("Acoes Corretivas")
    info(`Dependencias faltando: ${missingDeps.join(", ")}`)
    info("  Rode: gstack_vibehard install")
    info("  O instalador agora instala todas as deps automaticamente.")
  }

  section("Diagnostico concluido")
}
