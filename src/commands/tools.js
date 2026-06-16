import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { ppList, ppSearch, PrintingPressError } from "../printing-press/cli.js"
import { installTool, uninstallTool } from "../printing-press/install.js"
import { enableMcp, disableMcp, listMcp } from "../printing-press/mcp.js"
import { success, warn, error, info, section } from "../cli/index.js"

/** Caminho do registry do projeto no cwd. */
function registryPath(cwd = process.cwd()) {
  return join(cwd, ".gstack", "integrations.json")
}

function readRegistry(cwd) {
  const p = registryPath(cwd)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf-8"))
  } catch (e) {
    warn(`integrations.json ilegivel: ${e.message}`)
    return null
  }
}

function writeRegistry(cwd, reg) {
  writeFileSync(registryPath(cwd), JSON.stringify(reg, null, 2) + "\n")
}

function printItems(items) {
  for (const it of items.slice(0, 40)) {
    const name = it.slug || it.name || it.id || "?"
    const desc = it.description || it.summary || ""
    info(`  • ${name}${desc ? " — " + String(desc).slice(0, 70) : ""}`)
  }
  if (items.length > 40) info(`  … e mais ${items.length - 40}`)
}

export async function toolsCommand(args = [], opts = {}) {
  const sub = args[0]
  const cwd = opts.cwd || process.cwd()

  switch (sub) {
    case "suggested": {
      section("tools — sugeridas para este projeto")
      const reg = readRegistry(cwd)
      if (!reg) {
        warn("Sem .gstack/integrations.json aqui. Rode dentro de um projeto criado pelo gstack.")
        return
      }
      const suggested = reg.printingPress?.suggested || []
      if (suggested.length === 0) info("  (nenhuma sugestao)")
      else suggested.forEach((s) => info(`  • ${s}`))
      info("")
      info(`Roteamento: leitura → ${reg.routing?.reads}, escrita → ${reg.routing?.writes}`)
      return
    }

    case "list":
    case "search": {
      section(`tools — ${sub === "list" ? "catalogo Printing Press" : "busca"}`)
      let result
      try {
        result = sub === "list" ? ppList(opts) : ppSearch(args[1], opts)
      } catch (e) {
        if (e instanceof PrintingPressError) { error(e.message); return }
        throw e
      }
      if (!result.available) {
        warn(`Catalogo indisponivel (${result.error}). Verifique a rede ou tente novamente.`)
        info("Discovery e best-effort e nao altera nenhuma configuracao.")
        return
      }
      if (result.items.length === 0) info("  (nenhum resultado)")
      else printItems(result.items)
      return
    }

    case "installed": {
      section("tools — instaladas neste projeto")
      const reg = readRegistry(cwd)
      const installed = reg?.printingPress?.installed || []
      if (installed.length === 0) info("  (nenhuma ferramenta instalada)")
      else installed.forEach((t) => info(`  • ${t.name} [${t.status}]${t.cli ? " → " + t.cli : ""}`))
      return
    }

    case "install": {
      const slug = args[1]
      section(`tools — install ${slug || ""}`)
      const reg = readRegistry(cwd)
      if (!reg) { warn("Sem .gstack/integrations.json aqui. Rode dentro de um projeto gstack."); return }
      const result = installTool(slug, opts)
      if (result.status === "installed") {
        reg.printingPress.enabled = true
        reg.printingPress.discoveryInstalled = true
        reg.printingPress.installed = [
          ...(reg.printingPress.installed || []).filter((t) => t.name !== slug),
          result,
        ]
        writeRegistry(cwd, reg)
        success(`${slug} instalado (${result.cli}). Registry atualizado.`)
        info("Nenhuma credencial pedida. Se a ferramenta precisar de auth, veja `tools doctor`.")
      } else if (result.status === "needs_go") {
        warn(result.error)
      } else {
        error(`Falha ao instalar ${slug}: ${result.error || result.status}`)
      }
      return
    }

    case "uninstall": {
      const slug = args[1]
      section(`tools — uninstall ${slug || ""}`)
      const reg = readRegistry(cwd)
      const result = uninstallTool(slug, opts)
      if (reg?.printingPress?.installed) {
        reg.printingPress.installed = reg.printingPress.installed.filter((t) => t.name !== slug)
        writeRegistry(cwd, reg)
      }
      if (result.status === "uninstalled") success(`${slug} removido e registry limpo.`)
      else warn(`uninstall ${slug}: ${result.error || result.status} (entrada do registry removida)`)
      return
    }

    case "mcp": {
      const action = args[1]
      const tool = args[2]
      section(`tools mcp ${action || ""} ${tool || ""}`)
      if (action === "list") {
        const servers = listMcp(cwd)
        if (servers.length === 0) info("  (nenhum MCP pp-* habilitado neste projeto)")
        else servers.forEach((s) => info(`  • ${s}`))
        return
      }
      if (action === "enable") {
        const r = enableMcp(cwd, tool)
        if (r.status === "enabled") {
          success(`MCP ${r.name} habilitado no .mcp.json do projeto.`)
          // reflete no registry
          const reg = readRegistry(cwd)
          if (reg?.printingPress) {
            reg.printingPress.mcp = [...new Set([...(reg.printingPress.mcp || []), r.name])]
            writeRegistry(cwd, reg)
          }
        } else if (r.status === "exists") warn(`${r.name} ja existe — preservado (usuario vence).`)
        else error(`tool invalida: ${tool}`)
        return
      }
      if (action === "disable") {
        const r = disableMcp(cwd, tool)
        if (r.status === "disabled") {
          success(`MCP ${r.name} removido do projeto.`)
          const reg = readRegistry(cwd)
          if (reg?.printingPress?.mcp) {
            reg.printingPress.mcp = reg.printingPress.mcp.filter((m) => m !== r.name)
            writeRegistry(cwd, reg)
          }
        } else if (r.status === "not_found") warn(`${r.name} nao encontrado.`)
        else error(`tool invalida: ${tool}`)
        return
      }
      info("Uso: tools mcp enable|disable|list <tool>")
      return
    }

    case "enable-printing-press": {
      const reg = readRegistry(cwd)
      if (!reg) { warn("Sem .gstack/integrations.json aqui."); return }
      reg.printingPress = reg.printingPress || {}
      reg.printingPress.enabled = true
      reg.printingPress.discoveryInstalled = true
      writeRegistry(cwd, reg)
      success("Printing Press habilitado neste projeto (discovery). Nada foi instalado.")
      return
    }

    default:
      section("tools — integracoes (Composio nuvem + Printing Press local)")
      info("  gstack_vibehard tools suggested              Sugeridas para este projeto")
      info("  gstack_vibehard tools list                   Catalogo Printing Press")
      info("  gstack_vibehard tools search <termo>         Buscar no catalogo")
      info("  gstack_vibehard tools enable-printing-press  Habilitar discovery no projeto")
      info("")
      info("  Leitura de alta frequencia → Printing Press (CLI local + SQLite)")
      info("  Escrita / OAuth / apps padrao → Composio (nuvem)")
  }
}
