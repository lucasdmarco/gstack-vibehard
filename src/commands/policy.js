import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs"
import { join } from "path"
import { ADAPTER_MATRIX } from "../agents/adapter-matrix.js"
import { DEFAULT_POLICY, evaluate, validatePolicy } from "../policy/schema.js"
import { compilePolicy } from "../policy/compiler.js"
import { loadEffectivePolicy, localsGitignored, layerPath, REQUIRED_GITIGNORE } from "../policy/layers.js"
import { section, success, warn, error, info } from "../cli/index.js"

/**
 * `policy` — a Policy DSL canônica do GStack (PRD15 §7.1/§7.2/§7.6).
 *   policy init [--force]          → cria .gstack/policy.json + garante gitignore
 *   policy show [--json]           → policy efetiva (default←policy.json←policy.local.json)
 *   policy eval "<alvo>" [--json]  → decisão (deny>ask>allow>default)
 *   policy compile [--harness X] [--json] → artefatos por harness + nível honesto
 *   policy doctor [--json]         → valida schema, gitignore dos locais, segredos
 */

const KNOWN_HARNESSES = Object.keys(ADAPTER_MATRIX).filter((k) => k !== "unknown")

function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
function emit(json, obj, human) { if (json) { process.stdout.write(JSON.stringify(obj) + "\n"); return obj } human(obj); return obj }

function initCmd(ctx) {
  const dir = join(ctx.cwd, ".gstack")
  mkdirSync(dir, { recursive: true })
  const target = layerPath(ctx.cwd, "policy")
  const created = !existsSync(target) || ctx.args.includes("--force")
  if (created) writeFileSync(target, JSON.stringify(DEFAULT_POLICY, null, 2) + "\n")
  const gi = join(ctx.cwd, ".gitignore")
  const g = localsGitignored(ctx.cwd)
  if (!g.ok) appendFileSync(gi, (existsSync(gi) ? "\n" : "") + "# GStack config local (nunca comitar)\n" + REQUIRED_GITIGNORE.join("\n") + "\n")
  return emit(ctx.json, { created, path: target, gitignoreFixed: !g.ok }, () => {
    section("policy init")
    ;(created ? success : info)(`${created ? "criado" : "já existia"}: ${target}`)
    if (!g.ok) success(`.gitignore atualizado com ${REQUIRED_GITIGNORE.join(", ")}`)
  })
}

function showCmd(ctx) {
  const { policy, layers } = loadEffectivePolicy(ctx.cwd)
  return emit(ctx.json, { policy, layers }, () => {
    section("policy show — efetiva")
    info(`  camadas: ${layers.join(" ← ")}`)
    for (const d of ["deny", "ask", "allow"]) info(`  ${d}: ${policy.permissions[d].join(", ") || "(nenhum)"}`)
  })
}

function evalCmd(ctx) {
  const targetStr = ctx.args.filter((a) => !a.startsWith("-"))[1]
  if (!targetStr) { error('Uso: policy eval "Exec(git push)"'); return { error: "missing_target" } }
  const { policy } = loadEffectivePolicy(ctx.cwd)
  const r = evaluate(policy, targetStr)
  return emit(ctx.json, { target: targetStr, ...r }, () => {
    section("policy eval")
    const fn = r.decision === "deny" ? error : r.decision === "ask" ? warn : info
    fn(`  ${targetStr} → ${r.decision.toUpperCase()}${r.rule ? ` (regra: ${r.rule})` : " (default seguro)"}`)
  })
}

function compileCmd(ctx) {
  const { policy } = loadEffectivePolicy(ctx.cwd)
  const only = flag(ctx.args, "--harness")
  const harnesses = only ? [only] : KNOWN_HARNESSES
  const compiled = harnesses.map((h) => compilePolicy(policy, h))
  return emit(ctx.json, { compiled }, () => {
    section("policy compile — nível HONESTO por harness")
    for (const c of compiled) {
      const fn = c.level === "enforced" ? success : c.level === "partial" ? info : warn
      fn(`  ${c.harness}: ${c.level}${c.advisory ? " (advisory — não é Zero-Trust)" : ""} · alvo ${c.target}`)
    }
  })
}

function doctorCmd(ctx) {
  const { policy, layers } = loadEffectivePolicy(ctx.cwd)
  const v = validatePolicy(policy)
  const g = localsGitignored(ctx.cwd)
  const report = { valid: v.valid, errors: v.errors, layers, gitignore: g, ok: v.valid && g.ok }
  return emit(ctx.json, report, () => {
    section("policy doctor")
    ;(v.valid ? success : error)(v.valid ? "schema válido" : `schema inválido: ${v.errors.join("; ")}`)
    ;(g.ok ? success : warn)(g.ok ? "arquivos locais no .gitignore" : `.gitignore não cobre: ${g.missing.join(", ")} — rode \`policy init\``)
    info(`  camadas ativas: ${layers.join(" ← ")}`)
  })
}

const SUBCOMMANDS = { init: initCmd, show: showCmd, eval: evalCmd, compile: compileCmd, doctor: doctorCmd }

export function policyCommand(args = [], opts = {}) {
  const sub = args.find((a) => !a.startsWith("-")) || "show"
  const ctx = { sub, args, json: args.includes("--json"), cwd: opts.cwd || process.cwd() }
  return (SUBCOMMANDS[sub] || showCmd)(ctx)
}

export { KNOWN_HARNESSES }
