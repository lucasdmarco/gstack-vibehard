import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { ppList, ppSearch, PrintingPressError } from "../printing-press/cli.js"
import { installTool, uninstallTool } from "../printing-press/install.js"
import { enableMcp, disableMcp, listMcp } from "../printing-press/mcp.js"
import { doctorAll } from "../printing-press/doctor.js"
import { buildMcpInventory, renderInventoryHuman } from "../mcp/inventory.js"
import { agentReachCommand } from "./agent-reach.js"
import { success, warn, error, info, section } from "../cli/index.js"

/** Caminho do registry do projeto no cwd. */
function registryPath(cwd = process.cwd()) {
  return join(cwd, ".gstack", "integrations.json")
}

function readRegistry(cwd) {
  const p = registryPath(cwd)
  if (!existsSync(p)) return null
  try {
    return migrateRegistry(JSON.parse(readFileSync(p, "utf-8")))
  } catch (e) {
    warn(`integrations.json ilegivel: ${e.message}`)
    return null
  }
}

/**
 * Migra registries antigos (criados antes desta feature) para o schema atual,
 * garantindo o bloco printingPress com defaults — evita explodir ao mutar
 * reg.printingPress em projetos GStack antigos.
 */
function migrateRegistry(reg) {
  if (!reg || typeof reg !== "object") reg = {}
  reg.printingPress = {
    lane: "local",
    role: "read+longtail",
    enabled: false,
    discoveryInstalled: false,
    installed: [],
    suggested: [],
    mcp: [],
    ...(reg.printingPress || {}),
  }
  // normaliza arrays
  for (const k of ["installed", "suggested", "mcp"]) {
    if (!Array.isArray(reg.printingPress[k])) reg.printingPress[k] = []
  }
  return reg
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
      if (result.status === "uninstalled") {
        // So esquece do registry quando a remocao REAL teve sucesso
        if (reg?.printingPress) {
          reg.printingPress.installed = reg.printingPress.installed.filter((t) => t.name !== slug)
          reg.printingPress.mcp = (reg.printingPress.mcp || []).filter((m) => m !== `pp-${slug}`)
          writeRegistry(cwd, reg)
        }
        success(`${slug} removido e registry limpo.`)
      } else {
        // Falha: NAO remove do registry — marca o estado para nao "esquecer" o binario real
        if (reg?.printingPress?.installed) {
          const entry = reg.printingPress.installed.find((t) => t.name === slug)
          if (entry) { entry.status = "uninstall_failed"; writeRegistry(cwd, reg) }
        }
        warn(`uninstall ${slug}: ${result.error || result.status} — entrada mantida (marcada uninstall_failed)`)
      }
      return
    }

    // Agent Reach: capability layer com seletor de canais (PRD14 §4.15).
    // Sem section() antes: o subcomando controla o próprio output (--json puro).
    case "agent-reach":
      return agentReachCommand(args.slice(1), { ...opts, cwd })

    case "mcp": {
      const action = args[1]
      const tool = args[2]
      // inventory ANTES do banner: `--json` exige stdout puro (contrato de automação).
      if (action === "inventory") {
        const inv = buildMcpInventory({ cwd, home: opts.home })
        if (args.includes("--json")) { process.stdout.write(JSON.stringify(inv) + "\n"); return inv }
        section("tools mcp inventory — servidores MCP por harness")
        renderInventoryHuman(inv, { fragmentedOnly: args.includes("--fragmented"), print: (s) => info(s) })
        return inv
      }
      section(`tools mcp ${action || ""} ${tool || ""}`)
      if (action === "list") {
        const servers = listMcp(cwd)
        if (servers.length === 0) info("  (nenhum MCP pp-* habilitado neste projeto)")
        else servers.forEach((s) => info(`  • ${s}`))
        return
      }
      if (action === "enable") {
        const reg0 = readRegistry(cwd)
        const installedNames = (reg0?.printingPress?.installed || []).map((t) => t.name)
        const r = enableMcp(cwd, tool, { installed: installedNames.includes(tool), exec: opts.exec, skipBinaryCheck: opts.skipBinaryCheck })
        if (r.status === "not_installed") { warn(`${tool} nao esta instalada. ${r.hint}`); return }
        if (r.status === "missing_binary") { error(`MCP nao habilitado: ${r.hint}`); return }
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
      info("Uso: tools mcp enable|disable|list <tool> · tools mcp inventory [--json] [--fragmented]")
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

    case "doctor": {
      section("tools doctor — ferramentas instaladas")
      const reg = readRegistry(cwd)
      if (!reg) { warn("Sem .gstack/integrations.json aqui."); return }
      const results = doctorAll(reg, opts)
      if (results.length === 0) { info("  (nenhuma ferramenta instalada)"); return }
      for (const r of results) {
        const icon = r.status === "ok" ? "✓" : r.status === "warning" ? "⚠" : "✗"
        info(`  ${icon} ${r.tool} — binary:${r.binary} version:${r.version} auth:${r.auth} mcp:${r.mcp} [${r.status}]`)
      }
      return
    }

    case "generate": {
      // O gerador cli-printing-press (cauda-longa via HAR) ainda nao foi
      // publicado no npm. Stub honesto: nao quebra, orienta.
      section("tools generate — geracao via HAR (cauda-longa)")
      warn("Gerador indisponivel: o pacote cli-printing-press ainda nao foi publicado.")
      info("Quando disponivel, este comando forjara CLI+MCP de sistemas sem API a partir de capturas HAR.")
      info("Por ora, use o catalogo: gstack_vibehard tools list / search / install")
      return
    }

    default:
      section("tools — integracoes (Composio nuvem + Printing Press local)")
      info("  Descoberta:")
      info("    tools suggested               Sugeridas para este projeto")
      info("    tools list                    Catalogo Printing Press")
      info("    tools search <termo>          Buscar no catalogo")
      info("    tools enable-printing-press   Habilitar discovery no projeto")
      info("  Instalacao (opt-in):")
      info("    tools install <tool>          Instalar (instala Go sob demanda se faltar)")
      info("    tools uninstall <tool>        Remover")
      info("    tools installed               Listar instaladas")
      info("  MCP (project-scoped):")
      info("    tools mcp enable <tool>       Registrar pp-<tool> no .mcp.json do projeto")
      info("    tools mcp disable <tool>      Remover o pp-<tool>")
      info("    tools mcp list                Listar MCPs pp-* do projeto")
      info("    tools mcp inventory [--json] [--fragmented]  Inventario MCP por harness (read-only, secrets redigidos)")
      info("  Agent Reach (leitura/pesquisa na internet, opt-in):")
      info("    tools agent-reach enable [--core|--channels a,b|--dry-run|--safe]  Seletor de canais com consentimento")
      info("    tools agent-reach channels|doctor [--json]   Catalogo e estado por canal")
      info("  Qualidade:")
      info("    tools doctor                  Validar binario/auth/MCP das instaladas")
      info("    tools generate                Gerar CLI de cauda-longa via HAR (em breve)")
      info("")
      info("  Leitura de alta frequencia → Printing Press (CLI local + SQLite)")
      info("  Escrita / OAuth / apps padrao → Composio (nuvem)")
  }
}
