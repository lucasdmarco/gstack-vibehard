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
const impactAction = (path) => (existsSync(path) ? "modify" : "create")
function cat(category, label, paths, { global = true, optional = false } = {}) {
  return { category, label, global, optional, items: paths.map((path) => ({ path, action: impactAction(path) })) }
}
function impactOpts(opts) {
  return {
    home: opts.home || homedir(),
    harnessIds: opts.harnessIds || ["codex", "claude", "cursor", "opencode"],
    withDeps: opts.withDeps !== false,
    withMcp: opts.withMcp !== false,
    projectOnly: !!opts.projectOnly,
  }
}
// Config dos harnesses selecionados.
function harnessConfigPaths(harnessIds, h) {
  const paths = []
  if (harnessIds.includes("claude")) paths.push(h(".claude", "settings.json"))
  if (harnessIds.includes("cursor")) paths.push(h(".cursor", "hooks.json"))
  if (harnessIds.includes("opencode")) paths.push(h(".config", "opencode", "plugins"), h(".config", "opencode", "opencode.json"))
  return paths
}
// MCP global (opt-in) — muda ferramentas em todo projeto. null se pulado.
function mcpImpact(o, h) {
  if (o.projectOnly || !o.withMcp) return null
  return cat("mcp-global", "MCP global (muda ferramentas em todo projeto)", [h(".mcp.json"), h(".claude.json")], { optional: true })
}
// Dependências globais (pesadas). Fonte de verdade: installGlobalDeps (install.js);
// install_impact.test.js impede item fantasma aqui (ex.: `cli-anything-hub`).
function depsImpact() {
  return {
    category: "deps", label: "Dependências globais (PATH/caches do sistema)", global: true, optional: true,
    items: ["Bun", "uv", "Rust", "Playwright Chromium", "pytest", "Headroom"].map((path) => ({ path, action: "install-if-missing" })),
  }
}
export function buildInstallImpact(opts = {}) {
  const o = impactOpts(opts)
  const h = (...p) => join(o.home, ...p)
  const harnessPaths = harnessConfigPaths(o.harnessIds, h)
  const sections = [
    cat("hooks", "Hooks (Quality/Security Gates)", [h(".gstack", "hooks"), h(".codex", "hooks"), h(".claude", "hooks")]),
    harnessPaths.length ? cat("harness-config", "Config dos harnesses", harnessPaths) : null,
    mcpImpact(o, h),
    cat("skills-scripts", "Skills e scripts globais", [h(".agents", "skills"), h(".agents", "scripts")]),
    cat("identity", "Identidade/instrução global", [h("CLAUDE.md"), h(".claude", "rules", "ultracode.md")]),
    o.projectOnly ? null : cat("vault", "Vault Obsidian global", [h("gstack-vault")], { optional: true }),
    (o.withDeps && !o.projectOnly) ? depsImpact() : null,
  ]
  return sections.filter(Boolean)
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
