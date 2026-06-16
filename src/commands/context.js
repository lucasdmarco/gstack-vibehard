import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { buildContextRegistry, countDocs, DOC_SOURCES } from "../context-docs/registry.js"
import { success, warn, info, section } from "../cli/index.js"

function contextPath(cwd) {
  return join(cwd, ".gstack", "context.json")
}

function ensureDocDirs(cwd) {
  for (const rel of Object.values(DOC_SOURCES)) {
    const dir = join(cwd, rel)
    mkdirSync(dir, { recursive: true })
    const keep = join(dir, ".gitkeep")
    if (!existsSync(keep)) writeFileSync(keep, "")
  }
}

export async function contextCommand(args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const sub = args[0]

  switch (sub) {
    case "init": {
      section("context init — fundação de context docs")
      mkdirSync(join(cwd, ".gstack"), { recursive: true })
      const p = contextPath(cwd)
      // Idempotente: não sobrescreve se já existe
      if (!existsSync(p)) {
        writeFileSync(p, JSON.stringify(buildContextRegistry(), null, 2) + "\n")
        success("Criado .gstack/context.json")
      } else {
        info(".gstack/context.json já existe — preservado")
      }
      ensureDocDirs(cwd)
      success(`Diretórios de docs prontos: ${Object.values(DOC_SOURCES).join(", ")}`)
      info("Coloque ADRs/PRDs/plans/research em docs/* — o session_start injeta só um resumo.")
      return
    }

    case "status": {
      section("context status")
      const p = contextPath(cwd)
      if (!existsSync(p)) {
        warn("Sem .gstack/context.json. Rode `gstack_vibehard context init`.")
        return
      }
      let reg
      try { reg = JSON.parse(readFileSync(p, "utf-8")) } catch (e) { warn(`context.json ilegível: ${e.message}`); return }
      const c = countDocs(cwd)
      info(`injectMode: ${reg.sessionStart?.injectMode || "summary-only"}`)
      info(`ADR: ${c.adr} · PRD: ${c.prd} · plans: ${c.plans} · research: ${c.research} · total: ${c.total}`)
      return
    }

    default:
      section("context — contexto documental versionado")
      info("  gstack_vibehard context init     Criar .gstack/context.json + docs/{adr,prd,plans,research}")
      info("  gstack_vibehard context status   Contar docs (offline, summary-only)")
  }
}
