import { COMMANDS } from "../cli/index.js"

/**
 * Contrato `--json` (PRD51, DOD.13 do §9: "todo `--json` anunciado gera stdout JSON puro").
 *
 * A lacuna que este módulo fecha não era falta de teste — era falta da PERGUNTA. A pureza
 * de stdout vinha sendo provada comando a comando, onde alguém lembrou de provar, e não
 * havia nada que respondesse "quantos comandos anunciam `--json` e quantos foram
 * verificados?". Sem essa conta, cobertura parcial é indistinguível de cobertura total.
 *
 * Quem anuncia é DERIVADO do registry da CLI (`COMMANDS[].usage`), nunca de uma lista
 * paralela: uma lista à mão envelheceria exatamente como o manual envelheceu.
 *
 * ESCOPO HONESTO (mesma disciplina do `operation-registry.js`, S51.4.5): varrer os 21
 * anunciantes exigiria uma receita de invocação por comando — vários precisam de
 * subcomando, argumento ou ambiente. Em vez de fabricar chamadas genéricas que testariam
 * o caminho de erro em vez do contrato, cada comando ou tem RECEITA real ou sai
 * EXCLUÍDO com motivo. O que o módulo garante é que ninguém pode anunciar `--json` novo
 * e ficar fora da conta em silêncio.
 */
export const JSON_CONTRACT_SCHEMA = "gstack.json-contract.v1"

/** Comandos que ANUNCIAM `--json` no próprio usage do registry. Derivado, não declarado. */
export function commandsAdvertisingJson(commands = COMMANDS) {
  return commands.filter((c) => typeof c.usage === "string" && c.usage.includes("--json")).map((c) => c.name)
}

/**
 * Receitas de invocação SEGURAS (read-only ou dry-run) para varredura automática.
 * `args` roda num diretório temporário — nada toca o repositório nem o HOME real.
 */
export const SWEEP_RECIPES = Object.freeze({
  // `--dry-run` sai antes de qualquer escrita (estrutural, S51.2.5) — é a forma
  // documentada no próprio usage do comando.
  start: ["start", "um app de exemplo", "--dry-run", "--json"],
  // `consult` é read-only por construção (camada knowledge do firewall).
  consult: ["consult", "um app de exemplo", "--json"],
  // Persiste o plano, mas a varredura roda em tmpdir — nada toca o repositório.
  plan: ["plan", "um app de exemplo", "--json"],
  doctor: ["doctor", "--json"],
  prd: ["prd", "status", "--json"],
  actions: ["actions", "ledger", "--json"],
  policy: ["policy", "show", "--json"],
  state: ["state", "list", "--json"],
  runtime: ["runtime", "status", "--json"],
  dev: ["dev", "--json"],
  stop: ["stop", "--json"],
  worktree: ["worktree", "list", "--json"],
  skills: ["skills", "catalog", "--json"],
  create: ["create", "amostra", "--dry-run", "--json"],
})

/**
 * Excluídos da varredura AUTOMÁTICA, cada um com o motivo e onde o contrato já é provado.
 * Exclusão sem motivo é proibida por teste — é o que impede esta lista de virar depósito.
 */
export const SWEEP_EXCLUSIONS = Object.freeze({
  verify: "Executa a bateria de gates real (dezenas de segundos, subprocessos). Contrato provado em tests/e2e/dev_terminal.e2e.test.js e tests/verify_release_baseline_advisory.test.js.",
  proof: "Roda o proof completo — o comando mais caro do produto. Contrato provado em tests/proof_release.test.js.",
  "publish-guard": "Gate de publicação: exige árvore/estado de release real; invocá-lo às cegas testaria o caminho de recusa, não o contrato. Provado em tests/publish_guard_prd45.test.js.",
  dream: "Subcomandos divergem demais (audit/improve/promote/revoke/stale) para uma receita única. Contrato provado em tests/dream_cli_behavioral.test.js e tests/dream_freshness_cli.test.js.",
  research: "Subcomandos tocam rede/mirror e exigem consentimento explícito (S51.4.3). Varrer automaticamente contrariaria o próprio gate de consentimento.",
  visual: "Exige projeto com interface e, em parte dos caminhos, browser real. Provado em tests/visual_qa_real.test.js.",
  update: "Toca rede (checagem de versão publicada). Fora de varredura offline por decisão.",
  proxy: "Depende do proxy Headroom em execução; sem ele o comando responde o caminho degradado, não o contrato.",
  qa: "Precisa de diff/projeto real para produzir veredito; num tmpdir vazio testaria o caminho vazio. Provado em tests/qa_lenses.test.js.",
  loop: "Todo subcomando (observe/diagnose/checkpoint/rollback) exige um `--run <id>` de uma execução real; sem ele a varredura testaria a recusa por argumento faltante, não o contrato. Provado em tests/loop_checkpoint.test.js e tests/diagnose_loop.test.js.",
  onboarding: "O único subcomando que anuncia `--json` é `onboarding run`, que EXECUTA os setup-*.ps1/.sh de verdade. Varrer automaticamente rodaria instaladores a cada suíte — o custo e o efeito colateral desqualificam a varredura, não o contrato.",
})

/**
 * Anunciantes que não têm receita NEM exclusão declarada. Precisa ser sempre vazio: é a
 * checagem que impede um `--json` novo de entrar sem que alguém decida como prová-lo.
 */
export function unaccountedCommands(commands = COMMANDS) {
  return commandsAdvertisingJson(commands).filter((n) => !SWEEP_RECIPES[n] && !SWEEP_EXCLUSIONS[n])
}

/** Cobertura declarada do contrato — números reais, sem arredondar para cima. */
export function jsonContractCoverage(commands = COMMANDS) {
  const advertised = commandsAdvertisingJson(commands)
  const swept = advertised.filter((n) => SWEEP_RECIPES[n])
  const excluded = advertised.filter((n) => SWEEP_EXCLUSIONS[n])
  return {
    schemaVersion: JSON_CONTRACT_SCHEMA,
    advertised: advertised.length,
    swept: swept.length,
    excluded: excluded.length,
    unaccounted: unaccountedCommands(commands),
    sweptCommands: swept,
    excludedCommands: excluded,
  }
}

/**
 * Última linha de stdout que parseia como JSON. Comandos podem imprimir progresso humano
 * antes do payload; o contrato é que o JSON exista e seja parseável, não que seja a única
 * coisa escrita.
 */
export function lastJsonLine(out) {
  const linhas = String(out).trim().split("\n").filter(Boolean)
  for (let i = linhas.length - 1; i >= 0; i--) {
    try { return JSON.parse(linhas[i]) } catch { /* tenta a anterior */ }
  }
  return null
}
