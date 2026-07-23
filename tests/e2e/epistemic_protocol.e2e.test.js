import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..", "..")
const BIN = path.join(repoRoot, "src", "index.js")

/**
 * PRD50 S50.7 — E2E do protocolo epistêmico pelo BINÁRIO real.
 *
 * Roda o CLI de verdade (não importa módulo), num HOME/cwd descartáveis, para
 * provar comportamento de instalação real. Este arquivo roda na matriz de 3 SOs
 * do CI (`.github/workflows/test.yml`, job `e2e`) — Linux, Windows e macOS.
 */

function runCli(args, { cwd, home }) {
  return execFileSync(process.execPath, [BIN, ...args], {
    cwd, encoding: "utf-8", timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home, GSTACK_TEST_HOME: home },
  })
}

async function sandbox() {
  const home = await mkdtemp(path.join(tmpdir(), "gstack-ep-home-"))
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ep-cwd-"))
  return { home, cwd, cleanup: async () => { await rm(home, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true }) } }
}

test("E2E: `research validate --json` produz review válido pelo binário real", async () => {
  const s = await sandbox()
  try {
    const out = runCli(["research", "validate", "o projeto usa node", "--json"], s)
    const review = JSON.parse(out.trim().split("\n").pop())
    assert.equal(review.schemaVersion, "gstack.epistemic-review.v1")
    assert.ok(["sanity", "grounded", "adversarial"].includes(review.level))
    assert.ok(review.verdict)
  } finally { await s.cleanup() }
})

test("E2E: sem --network, NUNCA alega fonte externa e nunca sai supported", async () => {
  const s = await sandbox()
  try {
    const out = runCli(["research", "validate", "qual a versao mais recente do node", "--json"], s)
    const review = JSON.parse(out.trim().split("\n").pop())
    assert.deepEqual(review.sources, [], "zero fonte sem rede autorizada")
    assert.notEqual(review.verdict, "supported")
    assert.ok(review.notPerformed.length > 0, "declara o que não fez")
  } finally { await s.cleanup() }
})

test("E2E CONTROLE NEGATIVO: nada é escrito fora do cwd — HOME fica intocado", async () => {
  const s = await sandbox()
  try {
    const before = readdirSync(s.home).length
    runCli(["research", "validate", "claim qualquer", "--json"], s)
    assert.equal(readdirSync(s.home).length, before, "research validate é read-only: não escreve no HOME")
    assert.ok(!existsSync(path.join(s.home, ".gstack")), "nenhuma config global criada")
  } finally { await s.cleanup() }
})

test("E2E: --level adversarial é honrado pelo binário", async () => {
  const s = await sandbox()
  try {
    const out = runCli(["research", "validate", "pergunta simples", "--level", "adversarial", "--json"], s)
    assert.equal(JSON.parse(out.trim().split("\n").pop()).level, "adversarial")
  } finally { await s.cleanup() }
})

test("E2E: `consult --json` expõe o campo epistemic separando fato de inferência", async () => {
  const s = await sandbox()
  try {
    const out = runCli(["consult", "quero um SaaS com login", "--json"], s)
    const c = JSON.parse(out.trim().split("\n").pop())
    assert.equal(c.epistemic.schemaVersion, "gstack.epistemic-review.v1")
    const kinds = Object.fromEntries(c.epistemic.claims.map((x) => [x.id, x.kind]))
    assert.equal(kinds.installState, "fact")
    assert.equal(kinds.recommendedMode, "inference")
  } finally { await s.cleanup() }
})

test("E2E: saída humana mostra veredito e o que NÃO foi executado", async () => {
  const s = await sandbox()
  try {
    const out = runCli(["research", "validate", "algo verificavel"], s)
    assert.match(out, /Veredito:/)
    assert.match(out, /Não executado:/)
  } finally { await s.cleanup() }
})

test("E2E: JSON é PURO (parseável sem limpeza) — contrato de automação", async () => {
  const s = await sandbox()
  try {
    const out = runCli(["research", "validate", "claim", "--json"], s)
    const last = out.trim().split("\n").pop()
    assert.doesNotThrow(() => JSON.parse(last))
    assert.ok(!last.includes("["), "sem códigos ANSI de cor no JSON")
  } finally { await s.cleanup() }
})
