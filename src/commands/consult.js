import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { classify } from "../project-plan/classifier.js"
import { getRecipe, DEFAULT_RECIPE_ID } from "../project-plan/recipes.js"
import { buildReview } from "../epistemic/schema.js"
import { section, success, warn, info, error } from "../cli/index.js"

/**
 * `consult "<objetivo>"` — recomendação READ-ONLY estilo ECC (PRD14 §4.9):
 * uma trilha única, sem empilhar instalações. Não escreve NADA — só diz o
 * caminho recomendado, o preview e o rollback. `start` chama isto internamente.
 */

/** Superfícies de instalação presentes na máquina (probe read-only). */
export function detectInstallPaths({ home = homedir(), cwd = process.cwd() } = {}) {
  const surfaces = {
    globalHooks: existsSync(join(home, ".gstack", "hooks")),
    legacyCodexHooks: existsSync(join(home, ".codex", "hooks")),
    installManifest: existsSync(join(home, ".gstack_vibehard", "install-manifest.json")),
    projectActive: existsSync(join(cwd, ".gstack")),
  }
  // Empilhado: cópia legada (~/.codex/hooks) coexistindo com a atual (~/.gstack/hooks)
  const stacked = surfaces.globalHooks && surfaces.legacyCodexHooks
  return { ...surfaces, stacked }
}

/** Caminho ÚNICO recomendado a partir da recipe + estado da máquina. */
function pickPath(recipe, paths) {
  if (paths.projectActive) return { id: "already-active", command: "gstack_vibehard status", why: "este projeto já está ativo — não reinstale por cima" }
  if (recipe.recommendedMode === "full") {
    return { id: "create-full", command: `gstack_vibehard create <nome> --template ${recipe.template} --full`, why: recipe.modeReasons[0] || "recipe recomenda governança completa" }
  }
  return { id: "create-lite", command: `gstack_vibehard create <nome> --template ${recipe.template}`, why: "lite por padrão: escreve só ./<nome>, nada global" }
}

const DO_NOT_STACK_BASE = [
  "escolha UM caminho por máquina: create (projeto) OU install global — nunca os dois sem entender o impacto",
  "não misture install manual + plugin + full no mesmo harness",
]

function doNotStackFor(paths) {
  const rules = [...DO_NOT_STACK_BASE]
  if (paths.stacked) {
    rules.unshift("DETECTADO: hooks em ~/.gstack E ~/.codex (caminho legado) — você está usando dois caminhos; rode `gstack_vibehard install --reinstall` ou `uninstall --legacy-name-cleanup` para unificar")
  }
  return rules
}

/**
 * Recomendação pura (read-only, testável): perfil, modo, caminho, riscos,
 * preview e rollback. Contrato do aceite: recommendedPath, doNotStack,
 * previewCommand, rollbackCommand.
 */
/**
 * PRD50 S50.1 — 1º consumidor real do protocolo epistêmico (EV1).
 *
 * O `consult` sempre misturou duas coisas muito diferentes na mesma saída:
 * `installState` vem de sondagem REAL do disco (fato), enquanto `recommendedMode`
 * vem de heurística de keyword sobre o texto do objetivo (inferência). Aqui elas
 * passam a sair rotuladas. ADITIVO: nenhum campo existente muda de forma.
 */
function epistemicReviewFor({ objective, recipe, paths, path }) {
  const probed = Object.entries(paths).map(([k, v]) => `${k}=${v}`).join(", ")
  return buildReview({
    question: objective,
    level: "grounded",
    classificationReasons: ["claim sobre estado do produto/instalação (§9.2)"],
    claims: [
      {
        id: "installState", text: `superfícies de instalação detectadas: ${probed}`,
        kind: "fact", status: "supported",
        // Fato tem suporte REAL: a sondagem read-only do filesystem.
        support: [{ sourceId: "local:detectInstallPaths", excerpt: probed, kind: "local_primary" }],
        counterevidence: [], boundaryCases: [], tests: [], limitations: [], confidence: "high",
      },
      {
        id: "recommendedMode", text: `modo recomendado: ${recipe.recommendedMode}`,
        kind: "inference", status: "ambiguous",
        support: [], counterevidence: [], boundaryCases: [], tests: [],
        limitations: ["derivado de heurística de palavras-chave sobre o objetivo — não é medição do projeto"],
        confidence: "low",
      },
      {
        id: "recommendedPath", text: `${path.id}: ${path.why}`,
        kind: "recommendation", status: "not_applicable",
        support: [], counterevidence: [], boundaryCases: [], tests: [],
        limitations: ["recomendação, não verificação — execute o preview antes de aplicar"],
        confidence: "low",
      },
    ],
    protocol: { completed: true, iterations: 1, stopReason: "sufficient" },
    notPerformed: ["nenhuma fonte externa consultada", "nenhum comando de instalação executado"],
    tokenBudget: { network: false, extraModelCalls: 0, subagents: false, execution: false },
  })
}

export function buildConsult({ objective = "", home, cwd } = {}) {
  const cls = classify(objective)
  const recipe = getRecipe(cls.recipeId || DEFAULT_RECIPE_ID) || getRecipe(DEFAULT_RECIPE_ID)
  const paths = detectInstallPaths({ home, cwd })
  const path = pickPath(recipe, paths)
  return {
    objective,
    intent: recipe.id,
    template: recipe.template,
    recommendedMode: recipe.recommendedMode,
    recommendedPath: path,
    suggestedIntegrations: recipe.suggestedIntegrations,
    doNotStack: doNotStackFor(paths),
    previewCommand: "gstack_vibehard install --audit-only",
    rollbackCommand: "gstack_vibehard uninstall --dry-run",
    installState: paths,
    risks: paths.stacked ? ["instalação empilhada detectada (legado + atual)"] : [],
    epistemic: epistemicReviewFor({ objective, recipe, paths, path }),
  }
}

/** Render humano compartilhado com o `start` (resumo curto, sem paredão). */
export function renderConsultHuman(c, { compact = false } = {}) {
  if (!compact) section(`consult — ${c.objective || "(sem objetivo)"}`)
  info(`  Recomendação: ${c.recommendedPath.id} — ${c.recommendedPath.why}`)
  info(`    $ ${c.recommendedPath.command}`)
  info(`  Perfil: ${c.intent} (${c.template}) · modo ${c.recommendedMode}`)
  if (c.risks.length) c.risks.forEach((r) => warn(`  ⚠ ${r}`))
  if (compact) return
  info("  Um caminho só (não empilhe):")
  c.doNotStack.forEach((r) => info(`   • ${r}`))
  info(`  Preview sem escrita: ${c.previewCommand} · Rollback: ${c.rollbackCommand}`)
}

export function consultCommand(args = [], opts = {}) {
  const json = args.includes("--json")
  const objective = args.filter((a) => !a.startsWith("-")).join(" ").trim()
  if (!objective) {
    if (json) { process.stdout.write(JSON.stringify({ error: "missing_objective" }) + "\n"); return }
    section("consult")
    error('Descreva o objetivo: consult "quero um SaaS com login e Stripe"')
    return
  }
  const c = buildConsult({ objective, home: opts.home, cwd: opts.cwd })
  if (json) { process.stdout.write(JSON.stringify(c) + "\n"); return c }
  renderConsultHuman(c)
  return c
}
