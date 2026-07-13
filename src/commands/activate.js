import { existsSync, mkdirSync, writeFileSync, renameSync } from "fs"
import { join } from "path"
import { buildContextRegistry } from "../context-docs/registry.js"
import { detectProfile } from "../project-plan/detect-profile.js"
import { writeProjectMarker, hasValidMarker } from "../project/identity.js"
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
  // Reativa um projeto desativado (preserva contexto/planos). Garante o marcador
  // canônico (um `.gstack-disabled/` de antes do P0.3 pode não ter `project.json`).
  if (existsSync(gdisabled(cwd)) && !existsSync(gdir(cwd))) {
    renameSync(gdisabled(cwd), gdir(cwd))
    writeProjectMarker(cwd, { mode: "lite", createdBy: "gstack_vibehard:reactivate" })
    success("gstack REATIVADO neste projeto (dados preservados). Regras/hooks voltam a agir aqui.")
    return { status: "reactivated" }
  }
  if (existsSync(gdir(cwd))) {
    // Já tem `.gstack/`: se falta o marcador válido (projeto de antes do P0.3), o
    // projeto estava INERTE — migra gravando o marcador em vez de mentir "já ativo".
    if (!hasValidMarker(cwd)) {
      writeProjectMarker(cwd, { mode: "lite", createdBy: "gstack_vibehard:migrate" })
      success("gstack MIGRADO: `.gstack/` existia mas sem marcador canônico — agora ATIVO de verdade (hooks passam a agir).")
      if (existsSync(gdisabled(cwd))) warn("Há um `.gstack-disabled/` residual (de um disable anterior) — remova quando quiser, não é mais usado.")
      return { status: "migrated" }
    }
    info("gstack já está ATIVO neste projeto.")
    if (existsSync(gdisabled(cwd))) warn("Há um `.gstack-disabled/` residual (de um disable anterior) — remova quando quiser, não é mais usado.")
    return { status: "already_active" }
  }
  mkdirSync(gdir(cwd), { recursive: true })
  // Marcador CANÔNICO (P0.3): sem ele os hooks Python veem `.gstack/` como INERTE.
  // Ativar de verdade = gravar o marcador, não só criar a pasta (nada de falso-verde).
  writeProjectMarker(cwd, { mode: "lite", createdBy: "gstack_vibehard:enable" })
  const p = join(gdir(cwd), "context.json")
  if (!existsSync(p)) writeFileSync(p, JSON.stringify(buildContextRegistry(), null, 2) + "\n")
  // Detecta o ARQUÉTIPO e grava o profile.json: adoção observe-only (reporta,
  // nunca bloqueia) + dial de token padrão. Isso deixa os gates/regras se
  // adaptarem ao TIPO do projeto (lib/CLI/web/...), não a um molde "SaaS".
  const { profile, signals } = detectProfile(cwd)
  const profilePath = join(gdir(cwd), "profile.json")
  if (!existsSync(profilePath)) {
    writeFileSync(profilePath, JSON.stringify({ profile, signals, mode: "observe", tokenBudget: "standard", detectedAt: new Date().toISOString() }, null, 2) + "\n")
  }
  success(`gstack ATIVADO neste projeto (arquétipo: ${profile}, modo: observe).`)
  info("Regras/gates passam a agir aqui — em modo observe, REPORTAM e nunca bloqueiam.")
  info("Desligar depois: `gstack_vibehard disable`. Ver estado: `gstack_vibehard status`.")
  return { status: "activated", profile }
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
  // Fonte de verdade = marcador canônico (o mesmo que os hooks checam), não a mera
  // pasta. Um `.gstack/` sem marcador válido está INERTE — reportar isso, não "ativo".
  if (hasValidMarker(cwd)) { success("ATIVO — o gstack age neste projeto (marcador `.gstack/project.json` válido)."); return { status: "active" } }
  if (existsSync(gdir(cwd))) { warn("PRESENTE MAS INERTE — há `.gstack/` sem marcador canônico (hooks passivos). Rode `gstack_vibehard enable` para migrar."); return { status: "inert" } }
  if (existsSync(gdisabled(cwd))) { warn("DESATIVADO — reative com `gstack_vibehard enable` (dados em `.gstack-disabled/`)."); return { status: "disabled" } }
  info("INATIVO — projeto sem gstack (intocado). Ative com `gstack_vibehard enable`.")
  info("(Projetos novos criados com `gstack_vibehard create` já vêm ATIVOS.)")
  return { status: "inactive" }
}
