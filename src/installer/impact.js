import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

/**
 * Preflight de impacto do `install` (Safe Install — FINALPRODUCAO §3.1/§7/AC2).
 *
 * Função PURA: enumera, por categoria, os caminhos GLOBAIS que uma instalação
 * tocaria, sem escrever nada. `home` é injetável → testável sem tocar a máquina.
 * Cada item diz se seria `create` (não existe) ou `modify` (já existe).
 *
 * @returns {Array<{category, label, global, optional, items: Array<{path, action}>}>}
 */
export function buildInstallImpact(opts = {}) {
  const home = opts.home || homedir()
  const harnessIds = opts.harnessIds || ["codex", "claude", "cursor", "opencode"]
  const withDeps = opts.withDeps !== false
  const projectOnly = !!opts.projectOnly
  const h = (...p) => join(home, ...p)
  const cat = (category, label, paths, { global = true, optional = false } = {}) => ({
    category, label, global, optional,
    items: paths.map((path) => ({ path, action: existsSync(path) ? "modify" : "create" })),
  })

  const out = []

  // Hooks Python (Quality/Security Gates) — registrados global
  out.push(cat("hooks", "Hooks (Quality/Security Gates)", [
    h(".gstack", "hooks"), h(".codex", "hooks"), h(".claude", "hooks"),
  ]))

  // Config dos harnesses selecionados
  const harnessPaths = []
  if (harnessIds.includes("claude")) harnessPaths.push(h(".claude", "settings.json"))
  if (harnessIds.includes("cursor")) harnessPaths.push(h(".cursor", "hooks.json"))
  if (harnessIds.includes("opencode")) harnessPaths.push(h(".config", "opencode", "plugins"), h(".config", "opencode", "opencode.json"))
  if (harnessPaths.length) out.push(cat("harness-config", "Config dos harnesses", harnessPaths))

  // MCP global (opt-in recomendado) — pode mudar ferramentas em todos os projetos
  if (!projectOnly) {
    out.push(cat("mcp-global", "MCP global (muda ferramentas em todo projeto)", [
      h(".mcp.json"), h(".claude.json"),
    ], { optional: true }))
  }

  // Skills/scripts globais
  out.push(cat("skills-scripts", "Skills e scripts globais", [
    h(".agents", "skills"), h(".agents", "scripts"),
  ]))

  // Identidade/instrução global
  out.push(cat("identity", "Identidade/instrução global", [
    h("CLAUDE.md"), h(".claude", "rules", "ultracode.md"),
  ]))

  // Vault (segundo cérebro) — pulado em project-only
  if (!projectOnly) {
    out.push(cat("vault", "Vault Obsidian global", [h("gstack-vault")], { optional: true }))
  }

  // Dependências globais (pesadas) — puladas com --skip-deps/--project-only
  if (withDeps && !projectOnly) {
    out.push({
      category: "deps", label: "Dependências globais (PATH/caches do sistema)", global: true, optional: true,
      items: ["Bun", "uv", "Rust", "Playwright Chromium", "pytest", "cli-anything-hub", "Headroom"].map((path) => ({ path, action: "install-if-missing" })),
    })
  }

  return out
}

/** Renderiza o impacto como Markdown (para o install-report e o --audit-only). */
export function renderImpactMarkdown(impact, meta = {}) {
  const lines = [`# Relatório de impacto da instalação gstack_vibehard`, ""]
  if (meta.when) lines.push(`Gerado: ${meta.when}`)
  if (meta.harnessIds) lines.push(`Harnesses: ${meta.harnessIds.join(", ")}`)
  lines.push("", "> Preflight (audit-only): nada foi escrito. Lista do que seria tocado.", "")
  for (const c of impact) {
    lines.push(`## ${c.label}${c.optional ? " (opcional)" : ""}`)
    for (const it of c.items) lines.push(`- [${it.action}] ${it.path}`)
    lines.push("")
  }
  return lines.join("\n")
}
