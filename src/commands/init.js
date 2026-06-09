import { existsSync, mkdirSync, writeFileSync, readdirSync, copyFileSync } from "fs"
import { join, dirname, basename } from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { success, warn, error, info, confirm, prompt } from "../cli/index.js"

function resolvePythonCmd() {
  try { execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 3000 }); return "python3" } catch { return "python" }
}

function getProjectRoot() {
  const __filename = fileURLToPath(import.meta.url)
  let dir = dirname(__filename)
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = dirname(dir)
  }
  return dirname(__filename)
}

const PROJECT_ROOT = getProjectRoot()
const TEMPLATE_ROOT = join(PROJECT_ROOT, "templates", "templates", "fullstack-monorepo")

export async function initCommand(args) {
  const projectName = args[0]
  if (!projectName) {
    error("Uso: gstack_vibehard init <nome-do-projeto> --variant express|fastify|hono")
    process.exit(1)
  }

  let variant = "express"
  let shadcn = false
  const variantIdx = args.indexOf("--variant")
  if (variantIdx !== -1 && args[variantIdx + 1]) {
    variant = args[variantIdx + 1].toLowerCase()
    if (!["express", "fastify", "hono"].includes(variant)) {
      error("Variante invalida. Use: express, fastify, ou hono")
      process.exit(1)
    }
  }
  if (args.includes("--shadcn")) shadcn = true

  const projectDir = join(process.cwd(), projectName)

  if (existsSync(projectDir)) {
    error(`Diretorio '${projectName}' ja existe.`)
    process.exit(1)
  }

  // Python check
  const pyCmd = resolvePythonCmd()
  try {
    execFileSync(pyCmd, ["--version"], { stdio: "pipe", timeout: 5000 })
    info("Python encontrado")
  } catch (e) {
    warn("Python nao encontrado no PATH. Hooks Python exigem python3 instalado.")
    warn(`Python check: ${e.message || e}`)
    info("Instale Python: https://www.python.org/downloads/")
  }

  // Version check
  try {
    const local = execFileSync("npm", ["list", "-g", "@gstack-vibehard/installer", "--depth=0"], { encoding: "utf-8", timeout: 10000 }).trim()
    const latest = execFileSync("npm", ["view", "@gstack-vibehard/installer", "version"], { encoding: "utf-8", timeout: 10000 }).trim()
    const localVer = local.includes("@") ? local.split("@").pop()?.trim() : local
    if (latest !== localVer) {
      warn(`gstack_vibehard: versao ${localVer} instalada, ${latest} disponivel`)
      info("Para atualizar: npm update -g @gstack-vibehard/installer")
    } else {
      info(`gstack_vibehard ${localVer} — atualizado`)
    }
  } catch (e) {
    warn(`version check pulado: ${e.message || e}`)
  }

  info(`Criando projeto '${projectName}' (variante: ${variant})...`)

  // Create project directory
  mkdirSync(projectDir, { recursive: true })

  // Create .context7/
  const context7Dir = join(projectDir, ".context7")
  mkdirSync(context7Dir, { recursive: true })

  const stackJson = {
    project: projectName,
    frontend: { framework: "react 19", build: "vite 6", styling: "tailwind 4 + shadcn", state: "@tanstack/react-query", router: "react-router-dom" },
    backend: variant === "express" ? { framework: "express 5", orm: "drizzle", database: "postgresql (supabase)" }
           : variant === "fastify" ? { framework: "fastify 5", orm: "drizzle", database: "postgresql (neon)" }
           : { framework: "hono 4", orm: "drizzle", database: "sqlite (turso)" },
    infra: { hosting: variant === "express" ? "vercel" : variant === "fastify" ? "railway" : "render", database: variant === "express" ? "supabase" : variant === "fastify" ? "neon" : "turso", auth: "supabase" },
    tools: { monorepo: "pnpm workspaces", build: "turbo", typescript: true },
    updatedAt: new Date().toISOString().split("T")[0],
  }
  writeFileSync(join(context7Dir, "stack.json"), JSON.stringify(stackJson, null, 2))

  const agentsMd = `# ${projectName} — Contexto para Agentes

## Stack
- React 19 + Vite + shadcn/ui + Tailwind 4
- ${variant === "express" ? "Express 5 + Drizzle ORM + PostgreSQL (Supabase)" : variant === "fastify" ? "Fastify 5 + Drizzle ORM + PostgreSQL (Neon)" : "Hono 4 + Drizzle ORM + SQLite (Turso)"}
- pnpm workspaces + TurboRepo

## Estrutura
- apps/web → Frontend
- apps/api → Backend
- packages/db → Schema do banco
- packages/shared → Tipos compartilhados

## Comandos
- dev: pnpm dev
- build: pnpm build
- db generate: cd packages/db && npx drizzle-kit generate
- db push: cd packages/db && npx drizzle-kit push
`
  writeFileSync(join(context7Dir, "AGENTS.md"), agentsMd)
  success(".context7/ criado")

  // Create .gstack/
  const gstackDir = join(projectDir, ".gstack")
  mkdirSync(gstackDir, { recursive: true })

  const variantMap = {
    express: { stack: ["react", "vite", "express", "postgresql", "supabase"], infra: { frontend: "vercel", backend: "vercel", database: "supabase", auth: "supabase", storage: "supabase" }, api_dir: "apps/api", db_package: "packages/db", deploy: "vercel" },
    fastify: { stack: ["react", "vite", "fastify", "postgresql", "neon"], infra: { frontend: "vercel", backend: "railway", database: "neon", auth: "supabase", storage: "supabase" }, api_dir: "apps/api-fastify", db_package: "packages/db", deploy: "railway" },
    hono: { stack: ["react", "vite", "hono", "sqlite", "turso"], infra: { frontend: "vercel", backend: "render", database: "turso", auth: "supabase", storage: "supabase" }, api_dir: "apps/api-hono", db_package: "packages/db-turso", deploy: "render" },
  }
  const v = variantMap[variant]
  const gstackConfig = {
    project: projectName,
    node: "latest", npm: "latest", created: new Date().toISOString().split("T")[0],
    stack: v.stack, infra: v.infra, variant, api_dir: v.api_dir, db_package: v.db_package,
    tools: ["gstack_vibehard", "gbrain", "context7", "superpowers", "graphify", "headroom"],
    quality_gate: { script: "~/.gstack/hooks/qg.py", gstack_check: "~/.gstack/hooks/gc.py", levels: [1, 2, 3], fallback_script: "~/.codex/hooks/qg.py", fallback_gstack_check: "~/.codex/hooks/gc.py" },
    ecosystem: { gbrain: ".gbrain/context.json", graphify: ".graphify/deps.json", context7: ".context7/stack.json", chronicle: "~/.gstack/chronicle", fallback_chronicle: "~/.codex/chronicle" },
  }
  writeFileSync(join(gstackDir, "config.json"), JSON.stringify(gstackConfig, null, 2))
  success(".gstack/ criado")

  // Create .gbrain/
  const gbrainDir = join(projectDir, ".gbrain")
  mkdirSync(gbrainDir, { recursive: true })
  const gbrainContext = { project: projectName, description: "", objectives: [], stakeholders: [], decisions: [], glossary: {}, createdAt: new Date().toISOString().split("T")[0] }
  writeFileSync(join(gbrainDir, "context.json"), JSON.stringify(gbrainContext, null, 2))
  writeFileSync(join(gbrainDir, "README.md"), `# gbrain - Contexto do Negocio\n\n## Descricao\n(preencher)\n\n## Stack\n- React 19 + Vite + shadcn/ui + Tailwind 4\n- ${variant === "express" ? "Express 5 + Drizzle + Supabase" : variant === "fastify" ? "Fastify 5 + Drizzle + Neon" : "Hono 4 + Drizzle + Turso"}\n- pnpm workspaces + TurboRepo\n`)
  success(".gbrain/ criado")

  // Create .graphify/
  const graphifyDir = join(projectDir, ".graphify")
  mkdirSync(graphifyDir, { recursive: true })
  const graphifyDeps = { nodes: [{ id: "apps/web", type: "frontend", deps: [], devDeps: [] }, { id: "apps/api", type: "backend", deps: [], devDeps: [] }, { id: "packages/db", type: "database", deps: [], devDeps: [] }, { id: "packages/shared", type: "shared", deps: [], devDeps: [] }], edges: [{ from: "apps/web", to: "packages/db" }, { from: "apps/web", to: "packages/shared" }, { from: "apps/api", to: "packages/db" }, { from: "apps/api", to: "packages/shared" }] }
  writeFileSync(join(graphifyDir, "deps.json"), JSON.stringify(graphifyDeps, null, 2))
  writeFileSync(join(graphifyDir, "index.html"), '<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>Graphify - ' + projectName + '</title><script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script><style>body{font-family:system-ui;display:flex;flex-direction:column;align-items:center;padding:2rem;background:#f5f5f0}.mermaid{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:100%}h1{font-family:Anton,sans-serif;color:#1a1a1a}</style></head><body><h1>' + projectName + '</h1><div class="mermaid">graph TD\n  N0[apps/web - frontend]\n  N1[apps/api - backend]\n  N2[packages/db - database]\n  N3[packages/shared - shared]\n  N0-->|HTTP| N1\n  N0-->N2\n  N0-->N3\n  N1-->N2\n  N1-->N3\n</div><script>mermaid.initialize({startOnLoad:true})</script></body></html>')
  success(".graphify/ criado")

  // Create scripts/
  const scriptsDir = join(projectDir, "scripts")
  mkdirSync(scriptsDir, { recursive: true })
  writeFileSync(join(scriptsDir, "run.ps1"), `param([Parameter(Position=0)][ValidateSet('dev','build','db','deploy','help')][string]$Command='help')
switch ($Command) {
  'dev' { pnpm dev }
  'build' { pnpm build }
  'db' { Write-Host "Comandos do banco:" -ForegroundColor Cyan; Write-Host "  cd packages/db && npx drizzle-kit generate"; Write-Host "  cd packages/db && npx drizzle-kit push" }
  'deploy' { vercel --prod }
  'help' { Write-Host "=== Superpowers ===" -ForegroundColor Cyan; Write-Host "  .\\run.ps1 dev"; Write-Host "  .\\run.ps1 build"; Write-Host "  .\\run.ps1 db"; Write-Host "  .\\run.ps1 deploy" }
}`)
  success("scripts/ criado")

  // Copy template
  if (existsSync(TEMPLATE_ROOT)) {
    const copyRecursive = (src, dst) => {
      if (!existsSync(src)) return
      const entries = readdirSync(src, { withFileTypes: true })
      for (const entry of entries) {
        const s = join(src, entry.name)
        const d = join(dst, entry.name)
        if (entry.isDirectory()) {
          mkdirSync(d, { recursive: true })
          copyRecursive(s, d)
        } else {
          copyFileSync(s, d)
        }
      }
    }
    copyRecursive(TEMPLATE_ROOT, projectDir)
    success(`Template fullstack copiado para ${projectName}/`)
  } else {
    warn("Template nao encontrado no pacote")
  }

  // Design system (skip se --shadcn passado)
  if (shadcn) {
    writeFileSync(join(gstackDir, "session_state.json"), JSON.stringify({
      asked_about_design_system: true,
      design_system_path: "shadcn",
      workflow: "fullstack",
      created_at: new Date().toISOString().split("T")[0]
    }, null, 2))
    info("shadcn/ui registrado como design system (--shadcn)")
  } else {
  const hasDS = await confirm("Voce ja tem um design system proprio?", false)
  if (hasDS) {
    const dsPath = await prompt("Caminho da pasta do design system (ou deixe em branco)")
    if (dsPath) {
      writeFileSync(join(gstackDir, "session_state.json"), JSON.stringify({
        asked_about_design_system: true,
        design_system_path: dsPath,
        workflow: "fullstack",
        created_at: new Date().toISOString().split("T")[0]
      }, null, 2))
      info("Design system registrado. Os hooks vao respeitar seus tokens.")
    }
  } else {
    const wantDS = await confirm("Quer gerar um design system agora (frontend-design)?", false)
    if (wantDS) {
      info("Para gerar o design system, carregue a skill frontend-design:")
      info("  Em qualquer harness (Codex/Claude/OpenCode), peça para carregar a skill frontend-design")
      info("  Ou edite manualmente o arquivo gerado em design-system/MASTER.md")
      // Criar diretorio design-system/
      const dsDir = join(projectDir, "design-system")
      mkdirSync(dsDir, { recursive: true })
      writeFileSync(join(dsDir, "MASTER.md"), "# Design System\n\n<!-- Gerado automaticamente. Edite ou use a skill frontend-design para preencher. -->\n")
      success("design-system/MASTER.md criado (edite ou use skill frontend-design)")
      writeFileSync(join(gstackDir, "session_state.json"), JSON.stringify({
        asked_about_design_system: true,
        design_system_path: "design-system/",
        workflow: "fullstack",
        created_at: new Date().toISOString().split("T")[0]
      }, null, 2))
    } else {
      writeFileSync(join(gstackDir, "session_state.json"), JSON.stringify({
        asked_about_design_system: false,
        workflow: "fullstack",
        created_at: new Date().toISOString().split("T")[0]
      }, null, 2))
      info("Design system nao configurado. O hook pre_tool_use vai lembrar de perguntar antes de escrever UI.")
    }
  }
  }

  console.log()
  success(`Projeto '${projectName}' criado com sucesso!`)
  info("Proximos passos:")
  info(`  cd ${projectName}`)
  info(`  pnpm install`)
  info(`  pnpm dev`)
  info("")
  info("Estrutura:")
  info("  .context7/  — stack.json + AGENTS.md")
  info("  .gstack/    — config.json (infra + ferramentas)")
  info("  .gbrain/    — context.json (negocio)")
  info("  .graphify/  — deps.json + grafo visual")
  info("  scripts/    — run.ps1 (dev, build, db, deploy)")
  info("  apps/       — web (frontend) + api (backend)")
  info("  packages/   — db (schema) + shared (tipos)")
}
