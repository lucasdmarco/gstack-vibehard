import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.5 — classificador de intenção por PALAVRA (não substring frágil).
// "api" não pode casar "therapist"; "app" não casa "apply"; "ia" não casa "inteligencia".

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("matchesKeyword: casa palavra inteira, NÃO substring; acento-insensível", async () => {
  const { matchesKeyword, normalize } = await imp("src/project-plan/keyword-match.js")
  assert.equal(matchesKeyword(normalize("preciso de uma api rest"), "api"), true)
  assert.equal(matchesKeyword(normalize("sou um therapist experiente"), "api"), false, "api ⊄ therapist")
  assert.equal(matchesKeyword(normalize("vou apply o patch"), "app"), false, "app ⊄ apply")
  assert.equal(matchesKeyword(normalize("um app novo"), "app"), true)
  assert.equal(matchesKeyword(normalize("historia de inteligencia"), "ia"), false, "ia ⊄ inteligencia/historia")
  assert.equal(matchesKeyword(normalize("um agente de ia"), "ia"), true)
  // acento-insensível nos dois lados
  assert.equal(matchesKeyword(normalize("fazer a migração agora"), "migracao"), true)
})

test("classify (recipe): 'API REST de pagamentos' NÃO vira web-app por 'therapist'-style substring", async () => {
  const { classify } = await imp("src/project-plan/classifier.js")
  const api = classify("construir uma api rest com graphql")
  assert.equal(api.recipeId, "api-only", `veio ${api.recipeId} (matched: ${api.matched})`)
  // texto sem nenhuma keyword de palavra inteira → default, score 0
  const noise = classify("preciso de um therapist para apply minhas ideias")
  assert.equal(noise.score, 0, `substring não pode inflar score: matched=${noise.matched}`)
})

test("classify: keyword multi-palavra ('react native') casa; parcial não", async () => {
  const { classify } = await imp("src/project-plan/classifier.js")
  const m = classify("um app em react native")
  assert.equal(m.recipeId, "mobile-backend", `veio ${m.recipeId}`)
  assert.ok(m.matched.includes("react native"), "casou a keyword multi-palavra")
})

test("classifyLoop: 'pr' não casa 'prazo'; 'log' não casa 'login'", async () => {
  const { classifyLoop } = await imp("src/project-plan/loop-classifier.js")
  // "prazo" NÃO deve ativar review-followup (keyword "pr")
  const prazo = classifyLoop({ task: "ajustar o prazo do projeto" })
  assert.notEqual(prazo.loopPattern, "review-followup", `prazo casou review por 'pr': ${prazo.reason}`)
  // "login" NÃO deve ativar runtime-debugging por 'log'
  const login = classifyLoop({ task: "criar tela de login" })
  assert.notEqual(login.reason, "keywords casadas: log", "login não pode casar 'log'")
  // match real de palavra ainda funciona
  const bug = classifyLoop({ task: "corrigir o bug de runtime com erro 500" })
  assert.equal(bug.loopPattern, "runtime-debugging")
})

test("classifyLoop: sinais explícitos ainda decidem (hasRuntimeError)", async () => {
  const { classifyLoop } = await imp("src/project-plan/loop-classifier.js")
  const r = classifyLoop({ task: "algo genérico", hasRuntimeError: true })
  assert.equal(r.loopPattern, "runtime-debugging")
})
