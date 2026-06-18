import { existsSync, mkdirSync, writeFileSync, renameSync } from "fs"
import { join } from "path"
import { buildContextRegistry } from "../context-docs/registry.js"
import { success, warn, info, section } from "../cli/index.js"

/**
 * Ativação POR PROJETO (clara). O marcador é a pasta `.gstack/` (o que os hooks
 * checam via is_gstack_project). Projeto NOVO (`create`) já nasce ativo; projeto
 * EM ANDAMENTO fica intocado até `enable`. Toggle preserva os dados:
 *   enable  → cria/reativa `.gstack/`
 *   disable → renomeia `.gstack/` → `.gstack-disabled/` (hooks ficam passivos)
 *   status  → mostra ATIVO / INATIVO / DESATIVADO
 */
const gdir = (cwd) => join(cwd, ".gstack")
const gdisabled = (cwd) => join(cwd, ".gstack-disabled")

export async function activateCommand(sub, args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd()
  if (sub === "enable") return enable(cwd)
  if (sub === "disable") return disable(cwd)
  return status(cwd)
}

function enable(cwd) {
  section("gstack enable — ativar neste projeto")
  // Reativa um projeto desativado (preserva contexto/planos).
  if (existsSync(gdisabled(cwd)) && !existsSync(gdir(cwd))) {
    renameSync(gdisabled(cwd), gdir(cwd))
    success("gstack REATIVADO neste projeto (dados preservados). Regras/hooks voltam a agir aqui.")
    return { status: "reactivated" }
  }
  if (existsSync(gdir(cwd))) { info("gstack já está ATIVO neste projeto."); return { status: "already_active" } }
  mkdirSync(gdir(cwd), { recursive: true })
  const p = join(gdir(cwd), "context.json")
  if (!existsSync(p)) writeFileSync(p, JSON.stringify(buildContextRegistry(), null, 2) + "\n")
  success("gstack ATIVADO neste projeto — regras/hooks (Quality Gate, design-system, chronicle) passam a agir aqui.")
  info("Desligar depois: `gstack_vibehard disable`. Ver estado: `gstack_vibehard status`.")
  return { status: "activated" }
}

function disable(cwd) {
  section("gstack disable — desativar neste projeto")
  if (!existsSync(gdir(cwd))) { info("gstack já está INATIVO neste projeto (sem `.gstack/`)."); return { status: "already_inactive" } }
  if (existsSync(gdisabled(cwd))) {
    warn("Já existe `.gstack-disabled/` — remova/renomeie antes de desativar de novo (não vou sobrescrever).")
    return { status: "conflict" }
  }
  renameSync(gdir(cwd), gdisabled(cwd))
  success("gstack DESATIVADO neste projeto (dados preservados em `.gstack-disabled/`). Os hooks ficam passivos aqui.")
  info("Reativar quando quiser: `gstack_vibehard enable`.")
  return { status: "disabled" }
}

function status(cwd) {
  section("gstack status — neste projeto")
  if (existsSync(gdir(cwd))) { success("ATIVO — o gstack age neste projeto (`.gstack/` presente)."); return { status: "active" } }
  if (existsSync(gdisabled(cwd))) { warn("DESATIVADO — reative com `gstack_vibehard enable` (dados em `.gstack-disabled/`)."); return { status: "disabled" } }
  info("INATIVO — projeto sem gstack (intocado). Ative com `gstack_vibehard enable`.")
  info("(Projetos novos criados com `gstack_vibehard create` já vêm ATIVOS.)")
  return { status: "inactive" }
}
