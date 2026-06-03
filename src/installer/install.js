import { existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { detectHarnesses, isWindows, isMacOS } from "../harness/detector.js"
import { installCodex } from "../harness/codex.js"
import { installClaude } from "../harness/claude.js"
import { installOpenCode } from "../harness/opencode.js"
import { ensureDir, copyWithBackup } from "./merge.js"
import { prompt, confirm, select, multiSelect, success, warn, error, info, section } from "../cli/index.js"

const HOME = homedir()

function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url)
  let dir = dirname(__filename)
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

const PROJECT_ROOT = getProjectRoot()

export async function install() {
  section("Bem-vindo ao GStack VibeHard Installer")
  info("Este instalador vai configurar seu ambiente com:")
  info("  • Hooks Python (Quality Gate, Security Gate, Session Start)")
  info("  • Skills (frontend-design, chronicle, project-init)")
  info("  • Fullstack template (Express/Fastify/Hono)")
  info("  • 20 agentes especialistas com QG Gate")
  info("  • Design system taste-skill (4 engines + 3 dials)")

  // Step 1: Harness detection
  section("Passo 1/5 — Detectando Harnesses")
  const harnesses = detectHarnesses()

  if (harnesses.length === 0) {
    warn("Nenhum harness detectado.")
    info("O instalador ainda assim pode copiar hooks e skills.")
    const proceed = await confirm("Continuar mesmo assim?", true)
    if (!proceed) {
      error("Instalacao cancelada.")
      process.exit(0)
    }
  } else {
    info(`Harnesses detectados: ${harnesses.map((h) => h.label).join(", ")}`)
  }

  // Step 2: Choose harnesses to configure
  section("Passo 2/5 — Selecao de Harnesses")
  const harnessOptions = [
    { label: "OpenAI Codex CLI", value: "codex", checked: harnesses.some((h) => h.id === "codex") },
    { label: "Claude Code (Anthropic)", value: "claude", checked: harnesses.some((h) => h.id === "claude") },
    { label: "OpenCode CLI", value: "opencode", checked: harnesses.some((h) => h.id === "opencode") },
  ]

  const selectedHarnesses = await multiSelect(
    "Quais harnesses configurar?",
    harnessOptions
  )

  if (selectedHarnesses.length === 0) {
    error("Nenhum harness selecionado. Instalacao cancelada.")
    process.exit(0)
  }

  // Step 3: Components selection
  section("Passo 3/5 — Componentes")
  const componentOptions = [
    { label: "Hooks Python (qg.py, gc.py, session_start.py, stop.py)", value: "hooks", checked: true },
    { label: "Skills (frontend-design, chronicle, project-init)", value: "skills", checked: true },
    { label: "Template fullstack (3 variantes backend)", value: "template", checked: true },
    { label: "Agentes especialistas (20 agents + QG gate)", value: "agents", checked: true },
    { label: "Design system taste-skill (4 engines + dials)", value: "design", checked: true },
    { label: "MCP Servers (Fallow + Supabase)", value: "mcp", checked: false },
  ]

  // Claude-specific options
  const isClaude = selectedHarnesses.includes("claude")
  if (isClaude) {
    componentOptions.push({ label: "CLAUDE.md (identidade + QG gate)", value: "claudeMd", checked: true })
    componentOptions.push({ label: "Ultracode (regras de qualidade)", value: "ultracode", checked: true })
  }

  const selectedComponents = await multiSelect(
    "Quais componentes instalar?",
    componentOptions
  )

  // Step 4: Template variant (if template selected)
  let variant = "express"
  if (selectedComponents.includes("template")) {
    section("Passo 4/5 — Variante do Template")
    variant = await select(
      "Qual variante backend usar?",
      ["express (Express 5 + Supabase + Vercel)", "fastify (Fastify 5 + Neon + Railway)", "hono (Hono 4 + Turso + Render)"]
    )
    variant = variant.split(" ")[0]
  }

  // Step 5: Confirm
  section("Passo 5/5 — Confirmar Instalacao")
  info("Resumo da instalacao:")
  selectedHarnesses.forEach((h) => info(`  Harness: ${h}`))
  const componentLabels = {
    hooks: "Hooks Python",
    skills: "Skills",
    template: `Template (${variant})`,
    agents: "Agentes especialistas",
    design: "Design system",
    mcp: "MCP Servers",
    claudeMd: "CLAUDE.md",
    ultracode: "Ultracode",
  }
  selectedComponents.forEach((c) => info(`  Componente: ${componentLabels[c] || c}`))

  const confirmed = await confirm("Confirmar instalacao?", true)
  if (!confirmed) {
    error("Instalacao cancelada.")
    process.exit(0)
  }

  // Execute installation
  section("Instalando...")

  const report = { added: [], updated: [], skipped: [], errors: [] }

  // Install hooks
  if (selectedComponents.includes("hooks")) {
    const hooksDir = join(HOME, ".codex", "hooks")
    ensureDir(hooksDir)
    const hooksSource = join(PROJECT_ROOT, "hooks", "hooks")
    if (existsSync(hooksSource)) {
      const fs = await import("fs")
      const hooks = fs.readdirSync(hooksSource).filter((f) => f.endsWith(".py"))
      for (const hook of hooks) {
        const src = join(hooksSource, hook)
        const dst = join(hooksDir, hook)
        copyWithBackup(src, dst)
        report.added.push(`hook: ${hook}`)
      }
      success(`${hooks.length} hooks instalados em ~/.codex/hooks/`)
    } else {
      warn("Pasta de hooks nao encontrada no pacote")
    }
  }

  // Install skills
  if (selectedComponents.includes("skills")) {
    const skillsDir = join(HOME, ".agents", "skills")
    ensureDir(skillsDir)
    const skillsSource = join(PROJECT_ROOT, "skills", "skills")
    if (existsSync(skillsSource)) {
      const fs = await import("fs")
      const skills = fs.readdirSync(skillsSource, { withFileTypes: true }).filter((d) => d.isDirectory())
      for (const skill of skills) {
        const src = join(skillsSource, skill.name)
        const dst = join(skillsDir, skill.name)
        if (!existsSync(dst)) {
          copyWithBackup(src, dst)
          report.added.push(`skill: ${skill.name}`)
        } else {
          report.skipped.push(`skill: ${skill.name} (ja existe)`)
        }
      }
      success(`${skills.length} skills instaladas em ~/.agents/skills/`)
    }
  }

  // Install template
  if (selectedComponents.includes("template")) {
    const templateSource = join(PROJECT_ROOT, "templates", "templates", "fullstack-monorepo")
    if (existsSync(templateSource)) {
      info(`Template disponivel em: ${templateSource}`)
      info("Para copiar para seu projeto, use:")
      info(`  cp -r "${templateSource}" ./meu-projeto`)
      report.added.push(`template: fullstack-monorepo (${variant})`)
      success("Template pronto para uso")
    }
  }

  // Install agents
  if (selectedComponents.includes("agents")) {
    const agentsSource = join(PROJECT_ROOT, "agents")
    if (existsSync(agentsSource)) {
      info("Agentes disponiveis em: agents/")
      info("Para usar, copie a pasta .agent/ para seu projeto")
      report.added.push("agentes: 20 especialistas com QG gate")
      success("Agentes prontos para uso")
    }
  }

  // Claude-specific
  if (selectedComponents.includes("claudeMd") && selectedHarnesses.includes("claude")) {
    const { installClaude } = await import("../harness/claude.js")
    await installClaude({ claudeMd: true, ultracode: selectedComponents.includes("ultracode"), mcp: selectedComponents.includes("mcp") }, report)
    success("CLAUDE.md configurado")
  }

  if (selectedComponents.includes("ultracode") && selectedHarnesses.includes("claude")) {
    const { installClaude } = await import("../harness/claude.js")
    await installClaude({ ultracode: true, mcp: selectedComponents.includes("mcp") }, report)
    success("Ultracode configurado")
  }

  // MCP
  if (selectedComponents.includes("mcp")) {
    if (selectedHarnesses.includes("claude")) {
      const { installClaude } = await import("../harness/claude.js")
      await installClaude({ mcp: true }, report)
    }
    success("MCP Servers configurados")
  }

  // Run harness-specific installers
  for (const harness of selectedHarnesses) {
    section(`Configurando ${harness}...`)
    try {
      switch (harness) {
        case "codex":
          await installCodex({ hooks: selectedComponents.includes("hooks"), template: selectedComponents.includes("template") }, report)
          break
        case "claude":
          await installClaude({
            claudeMd: selectedComponents.includes("claudeMd"),
            ultracode: selectedComponents.includes("ultracode"),
            mcp: selectedComponents.includes("mcp"),
          }, report)
          break
        case "opencode":
          await installOpenCode({ hooks: selectedComponents.includes("hooks") }, report)
          break
      }
      success(`${harness} configurado`)
    } catch (e) {
      report.errors.push(`${harness}: ${e.message}`)
      warn(`Falha ao configurar ${harness}: ${e.message}`)
    }
  }

  // Report
  section("Relatorio da Instalacao")
  if (report.added.length > 0) {
    info("Adicionados:")
    report.added.forEach((item) => info(`  + ${item}`))
  }
  if (report.updated.length > 0) {
    info("Atualizados:")
    report.updated.forEach((item) => info(`  ~ ${item}`))
  }
  if (report.skipped.length > 0) {
    info("Pulados (ja existem):")
    report.skipped.forEach((item) => info(`  - ${item}`))
  }
  if (report.errors.length > 0) {
    info("Erros:")
    report.errors.forEach((item) => warn(`  ${item}`))
  }

  section("Instalacao Concluida!")
  info("Comandos uteis:")
  info("  gstack doctor    — diagnosticar ambiente")
  info("  gstack uninstall — remover GStack do ambiente")
  if (selectedHarnesses.includes("claude")) {
    info("")
    info("Claude Code: novas regras ativas na proxima sessao")
  }

  console.log()
}
