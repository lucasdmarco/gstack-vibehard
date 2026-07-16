import test from "node:test"
import assert from "node:assert/strict"
import { publishGuard } from "../src/project-plan/publish-guard.js"

// PRD45 S45.0 — "adicionar publish guard para `dream NOT_PROVED` required e teste E2E falho".
// Dois buracos reais no caminho de release:
//   (1) o produto podia publicar declarando contrato comportamental para um claim que NÃO
//       está REAL — prometendo prova que não tem;
//   (2) o publish não olhava o relatório de capacidades: um backend `required` fora de
//       `passed` (failed / not_proved / blocked_missing_engine) não impedia a publicação.
// Ambos HARD: reprovam o guard (status "fail"), não são aviso.

// Isola dos gates pré-existentes (tree/version/changelog): o foco é o check novo.
const baseOpts = (extra) => ({
  cwd: process.cwd(),
  exec: () => "", // git silencioso
  checkCi: false,
  ...extra,
})
const dreamOk = () => ({ summary: { REAL: 1, RISK: 0, PLACEBO: 0 }, claims: [{ id: "verify", status: "REAL" }] })
const capsOk = () => ({ capabilities: [{ id: "casdoor-rbac", required: true, status: "passed" }] })
const findCheck = (r, id) => r.checks.find((c) => c.id === id)

test("dream-required: claim COM contrato declarado que não está REAL reprova (HARD)", () => {
  const r = publishGuard(baseOpts({
    // `verify` tem contrato comportamental declarado em CLAIM_CONTRACTS.
    dream: () => ({ summary: { REAL: 0, RISK: 0, PLACEBO: 0, NOT_PROVED: 1 }, claims: [{ id: "verify", status: "NOT_PROVED" }] }),
    capabilityReport: capsOk,
  }))
  const c = findCheck(r, "dream-required")
  assert.equal(c.status, "failed", "contrato declarado + claim não-REAL = promessa sem prova")
  assert.match(c.detail, /verify/)
  assert.ok(r.failed.includes("dream-required"), "é HARD: entra em failed")
  assert.equal(r.status, "fail")
})

test("dream-required: RISK/PLACEBO nunca publicam", () => {
  const risk = publishGuard(baseOpts({
    dream: () => ({ summary: { REAL: 1, RISK: 1, PLACEBO: 0 }, claims: [{ id: "verify", status: "REAL" }] }),
    capabilityReport: capsOk,
  }))
  assert.equal(findCheck(risk, "dream-required").status, "failed")
  const placebo = publishGuard(baseOpts({
    dream: () => ({ summary: { REAL: 1, RISK: 0, PLACEBO: 2 }, claims: [{ id: "verify", status: "REAL" }] }),
    capabilityReport: capsOk,
  }))
  assert.equal(findCheck(placebo, "dream-required").status, "failed")
})

test("dream-required: claim SEM contrato pode ficar NOT_PROVED sem travar o release", () => {
  // Só o que o produto declarou provar é `required`. O resto é NOT_PROVED honesto —
  // travar em todos tornaria o gate impossível (19 NOT_PROVED hoje) e ele viraria enfeite.
  const r = publishGuard(baseOpts({
    dream: () => ({ summary: { REAL: 1, RISK: 0, PLACEBO: 0, NOT_PROVED: 19 }, claims: [
      { id: "verify", status: "REAL" }, { id: "governance", status: "NOT_PROVED" },
    ] }),
    capabilityReport: capsOk,
  }))
  assert.equal(findCheck(r, "dream-required").status, "passed")
})

test("capability-e2e: capacidade REQUIRED not_proved reprova (o falso-verde do daemon)", () => {
  const r = publishGuard(baseOpts({
    dream: dreamOk,
    capabilityReport: () => ({ capabilities: [
      { id: "casdoor-rbac", required: true, status: "passed" },
      { id: "atomic-merge", required: true, status: "not_proved" },
    ] }),
  }))
  const c = findCheck(r, "capability-e2e")
  assert.equal(c.status, "failed")
  assert.match(c.detail, /atomic-merge/)
  assert.ok(r.failed.includes("capability-e2e"), "é HARD")
})

test("capability-e2e: required failed ou blocked_missing_engine também reprovam", () => {
  for (const bad of ["failed", "blocked_missing_engine"]) {
    const r = publishGuard(baseOpts({
      dream: dreamOk,
      capabilityReport: () => ({ capabilities: [{ id: "casdoor-rbac", required: true, status: bad }] }),
    }))
    assert.equal(findCheck(r, "capability-e2e").status, "failed", `${bad} não pode publicar`)
  }
})

test("capability-e2e: opcional fora de passed NÃO bloqueia; not_applicable de required também não", () => {
  const r = publishGuard(baseOpts({
    dream: dreamOk,
    capabilityReport: () => ({ capabilities: [
      { id: "casdoor-rbac", required: true, status: "passed" },
      { id: "openhands-sandbox", required: false, status: "not_proved" },
      // plataforma não suporta = honesto, documentado; não é dívida de prova.
      { id: "so-especifico", required: true, status: "not_applicable" },
    ] }),
  }))
  assert.equal(findCheck(r, "capability-e2e").status, "passed")
})

test("capability-e2e: sem relatório => not_applicable com ação (nunca 'passed' por omissão)", () => {
  const r = publishGuard(baseOpts({ dream: dreamOk, capabilityReport: () => null }))
  const c = findCheck(r, "capability-e2e")
  assert.equal(c.status, "not_applicable")
  assert.match(c.detail, /test:cleanmachine/, "diz o que rodar")
  assert.ok(!r.failed.includes("capability-e2e"), "ausência de relatório não é reprovação")
})

test("tudo provado => os dois checks passam (gate satisfazível)", () => {
  const r = publishGuard(baseOpts({ dream: dreamOk, capabilityReport: capsOk }))
  assert.equal(findCheck(r, "dream-required").status, "passed")
  assert.equal(findCheck(r, "capability-e2e").status, "passed")
})
