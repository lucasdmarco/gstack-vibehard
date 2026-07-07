import { existsSync, readFileSync } from "fs"
import { join, resolve, dirname, basename } from "path"
import { homedir } from "os"
import { stripBom } from "../util/json.js"

/**
 * Workspace classifier + tradutor de erros npm (PRD28 Sprint 28.0).
 *
 * Causa raiz do bug de máquina limpa: o usuário leigo caiu em `npm install` /
 * `npm install react` / `npm run dev` em `C:\Users\Windows` (o HOME dele) porque
 * nada classificou ONDE ele estava antes de orientar. Este módulo dá o estado
 * honesto do diretório e a PRÓXIMA AÇÃO GStack — nunca npm cru.
 *
 * PURO/testável: io injetável (exists/readJson/home). Nunca lê `.env*`.
 */

export const WORKSPACE_STATES = Object.freeze({
  home_or_wrong_cwd: "sem projeto aqui (parece o diretório home do usuário)",
  empty_git_repo: "repositório Git sem app executável",
  gstack_project: "projeto GStack (runtime gerenciado)",
  node_app: "app Node existente (sem GStack)",
  empty_dir: "pasta neutra sem projeto — lugar seguro para criar um novo",
  unknown: "sinais conflitantes — diagnóstico read-only, nenhuma escrita automática",
})

// HOME-like: o próprio home, OU filho direto da raiz de usuários (C:\Users\<x>,
// /home/<x>, /Users/<x>) — o caso real do transcript era C:\Users\Windows.
function isHomeLike(cwd, home) {
  const c = resolve(cwd)
  if (c === resolve(home)) return true
  const parent = basename(dirname(c)).toLowerCase()
  return parent === "users" || parent === "home"
}

function defaultIo() {
  return {
    exists: (p) => existsSync(p),
    readJson: (p) => { try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null } },
    home: homedir(),
  }
}

// Sinais read-only do diretório (nunca abre `.env*`).
function collectSignals(cwd, io) {
  const pkg = io.exists(join(cwd, "package.json")) ? io.readJson(join(cwd, "package.json")) : null
  return {
    hasGstackApp: io.exists(join(cwd, ".gstack", "app.json")),
    // runtime.json (v2) OU services.json (v1) — os dois que loadRuntimeManifest aceita.
    hasRuntimeManifest: io.exists(join(cwd, ".gstack", "runtime.json")) || io.exists(join(cwd, ".gstack", "services.json")),
    hasPackageJson: pkg !== null,
    packageJsonInvalid: io.exists(join(cwd, "package.json")) && pkg === null,
    scripts: pkg && pkg.scripts ? Object.keys(pkg.scripts) : [],
    hasGit: io.exists(join(cwd, ".git")),
    homeLike: isHomeLike(cwd, io.home),
  }
}

// Próxima ação por estado — SEMPRE trilha GStack, nunca `npm install` cru.
const STATE_ACTIONS = Object.freeze({
  home_or_wrong_cwd: [
    "gstack_vibehard start           (criar um novo projeto guiado)",
    "cd <caminho-do-projeto>         (entrar em um projeto existente)",
    "gstack_vibehard doctor          (apenas diagnosticar)",
  ],
  empty_git_repo: [
    "gstack_vibehard start           (criar scaffold neste diretório)",
    "gstack_vibehard create <nome>   (criar projeto em nova pasta)",
  ],
  gstack_project: [
    "gstack_vibehard dev             (subir o runtime)",
    "gstack_vibehard proof --json    (veredito de pronto)",
  ],
  node_app: [
    "gstack_vibehard dev             (se houver runtime GStack)",
    "gstack_vibehard init            (adaptar este app ao GStack)",
  ],
  empty_dir: [
    "gstack_vibehard start           (criar um projeto guiado aqui)",
    "gstack_vibehard create <nome>   (criar direto)",
  ],
  unknown: [
    "gstack_vibehard doctor --json   (diagnóstico read-only)",
  ],
})

/**
 * Classifica o diretório: home_or_wrong_cwd | empty_git_repo | gstack_project |
 * node_app | unknown. Retorna sinais + próximas ações GStack (nunca npm cru).
 */
export function classifyWorkspace(cwd, io = {}) {
  const ctx = { ...defaultIo(), ...io }
  const signals = collectSignals(cwd, ctx)
  const state = resolveState(signals)
  return { state, description: WORKSPACE_STATES[state], signals, actions: [...STATE_ACTIONS[state]] }
}

// Cadeia de decisão como TABELA (primeira regra que casa vence; cc baixa).
const STATE_RULES = [
  [(s) => s.hasGstackApp || s.hasRuntimeManifest, "gstack_project"],
  [(s) => s.hasPackageJson, "node_app"],
  [(s) => s.packageJsonInvalid, "unknown"],
  [(s) => s.homeLike, "home_or_wrong_cwd"],
  [(s) => s.hasGit, "empty_git_repo"],
]
function resolveState(s) {
  const hit = STATE_RULES.find(([test]) => test(s))
  return hit ? hit[1] : "empty_dir" // pasta neutra: lugar SEGURO para criar — o guard não interrompe
}

// ── Tradutor de erros npm → diagnóstico + próxima ação GStack ────────────────────
// Tabela (cc baixa): cada entrada casa por regex no texto do erro cru do npm.
const NPM_ERROR_TABLE = Object.freeze([
  {
    id: "enoent_package_json",
    match: /ENOENT.*package\.json|Could not read package\.json/i,
    diagnosis: "Você não está em uma pasta de projeto Node/GStack.",
    nextAction: "Rode `gstack_vibehard start` para criar um projeto, ou `cd <projeto>` para entrar em um existente. NÃO rode `npm install` nesta pasta.",
  },
  {
    id: "missing_script",
    match: /Missing script:?\s*"?dev"?|missing script/i,
    diagnosis: "Existe package.json, mas este diretório não tem script de dev executável.",
    nextAction: "Use `gstack_vibehard dev` (runtime gerenciado) ou `gstack_vibehard create <nome>` para um projeto novo. NÃO instale pacotes soltos para 'consertar'.",
  },
  {
    id: "ps_execution_policy",
    match: /npm\.ps1.*(cannot be loaded|não pode ser carregad)|running scripts is disabled|execução de scripts foi desabilitada/i,
    diagnosis: "A política do PowerShell bloqueou o shim npm.ps1.",
    nextAction: "O GStack chama `npm.cmd` internamente no Windows — use os comandos gstack_vibehard. Se precisar do npm direto, rode `npm.cmd <args>`.",
  },
  {
    id: "npm_hang_or_network",
    match: /ETIMEDOUT|ECONNRESET|network|registry.*(timeout|error)/i,
    diagnosis: "Rede/registry indisponível ou instalação pendurada — o projeto NÃO está quebrado.",
    nextAction: "Rode `gstack_vibehard doctor node --json` (mostra registry/timeout) e tente de novo com a rede estável.",
  },
])

/** Traduz erro npm cru em diagnóstico + ação de produto. null = sem tradução. */
export function translateNpmError(text) {
  const t = String(text || "")
  const hit = NPM_ERROR_TABLE.find((e) => e.match.test(t))
  return hit ? { id: hit.id, diagnosis: hit.diagnosis, nextAction: hit.nextAction } : null
}

/** Conteúdo do `.gstack/NEXT_STEPS.md` gravado pelo create (next-step contract). */
export function nextStepsContent(projectName) {
  return [
    `# Próximos passos — ${projectName}`,
    "",
    "Projeto criado com sucesso. Os comandos abaixo são a trilha oficial:",
    "",
    "```",
    `1. cd ${projectName}`,
    "2. gstack_vibehard dev              # sobe o runtime (logs + readiness)",
    "3. gstack_vibehard verify --json    # gates determinísticos",
    "4. gstack_vibehard proof --json     # veredito único: está pronto?",
    "```",
    "",
    "Parar: `gstack_vibehard stop` · Logs: `gstack_vibehard logs <serviço>`",
    "",
    "**Não rode `npm install` no diretório home.** O GStack gerencia o runtime",
    "do projeto — se algo falhar, `gstack_vibehard doctor node --json` diagnostica.",
    "",
  ].join("\n")
}
