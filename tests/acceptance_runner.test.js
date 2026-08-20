/**
 * PRD52 S52.J — o runner que produz o compliance EXECUTADO.
 *
 * A propriedade que estes testes defendem é uma só, e é assimétrica de
 * propósito: **ausência de resultado nunca vira aprovação**. Um aceite sem
 * execução fica fora do mapa, e o `checkCompliance` o traduz em `unverified`
 * com a razão. Preencher com `true` reporia o defeito que o sprint removeu;
 * preencher com `false` diria "reprovou", que é outra afirmação e também
 * falsa.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const R = () => imp("src/project-plan/acceptance-runner.js")

const aceiteGate = (id, ref) => ({ id, verifier: { kind: "gate", ref } })
const relatorio = (steps, status = "ready") => ({ status, steps })

test("gate resolve pelo STEP REAL do verify, não por o aceite citar um gate", async () => {
  const { executarVerificadores } = await R()
  const r = executarVerificadores({
    acceptances: [aceiteGate("lint", "lint")],
    verifyReport: relatorio([{ id: "lint", status: "passed" }]),
  })
  assert.deepEqual(r, { lint: true })
})

test("CONTROLE NEGATIVO: sem relatório de verify, o aceite fica SEM resultado", async () => {
  const { executarVerificadores } = await R()
  assert.deepEqual(executarVerificadores({ acceptances: [aceiteGate("lint", "lint")], verifyReport: null }), {},
    "verify que não rodou não aprova nem reprova — some do mapa")
})

test("CONTROLE NEGATIVO: step ausente do relatório não vira aprovação", async () => {
  const { executarVerificadores } = await R()
  assert.deepEqual(executarVerificadores({
    acceptances: [aceiteGate("lint", "lint")],
    verifyReport: relatorio([{ id: "outro", status: "passed" }]),
  }), {})
})

test("CONTROLE NEGATIVO: `not_applicable` NÃO é aprovação", async () => {
  const { executarVerificadores } = await R()
  assert.deepEqual(executarVerificadores({
    acceptances: [aceiteGate("lint", "lint")],
    verifyReport: relatorio([{ id: "lint", status: "not_applicable" }]),
  }), {}, "o gate não se aplicou, então o aceite que dependia dele continua sem resultado")
})

test("step reprovado devolve `false` — e reprovar É um resultado", async () => {
  const { executarVerificadores } = await R()
  assert.deepEqual(executarVerificadores({
    acceptances: [aceiteGate("lint", "lint")],
    verifyReport: relatorio([{ id: "lint", status: "failed" }]),
  }), { lint: false })
})

test("`qg --strict` exige os DOIS níveis — aprovar por um só seria strict pela metade", async () => {
  const { executarVerificadores, STEP_DO_GATE } = await R()
  assert.deepEqual(STEP_DO_GATE["qg --strict"], ["qg-l1", "qg-l2"])
  const ambos = relatorio([{ id: "qg-l1", status: "passed" }, { id: "qg-l2", status: "passed" }])
  assert.deepEqual(executarVerificadores({ acceptances: [aceiteGate("qg", "qg --strict")], verifyReport: ambos }),
    { qg: true })
  const umSo = relatorio([{ id: "qg-l1", status: "passed" }, { id: "qg-l2", status: "failed" }])
  assert.deepEqual(executarVerificadores({ acceptances: [aceiteGate("qg", "qg --strict")], verifyReport: umSo }),
    { qg: false })
  const faltando = relatorio([{ id: "qg-l1", status: "passed" }])
  assert.deepEqual(executarVerificadores({ acceptances: [aceiteGate("qg", "qg --strict")], verifyReport: faltando }), {},
    "com um nível ausente do relatório não há veredito de `strict`")
})

test("`verify --profile scaffold` usa o veredito do verify INTEIRO", async () => {
  const { executarVerificadores } = await R()
  const aceite = [aceiteGate("scaffold", "verify --profile scaffold")]
  assert.deepEqual(executarVerificadores({ acceptances: aceite, verifyReport: relatorio([], "ready") }), { scaffold: true })
  assert.deepEqual(executarVerificadores({ acceptances: aceite, verifyReport: relatorio([], "blocked") }), { scaffold: false })
})

test("`command` EXECUTA o ref e lê o exit code", async () => {
  const { executarVerificadores } = await R()
  const chamadas = []
  const ok = executarVerificadores({
    acceptances: [{ id: "e2e", verifier: { kind: "command", ref: "npm test" } }],
    projectDir: "/tmp/x",
    exec: (bin, args, opts) => { chamadas.push({ bin, args, cwd: opts.cwd }); return "" },
  })
  assert.deepEqual(ok, { e2e: true })
  assert.deepEqual(chamadas, [{ bin: "npm", args: ["test"], cwd: "/tmp/x" }],
    "o comando roda no diretório do PROJETO, com o ref quebrado em binário e argumentos")
})

test("CONTROLE NEGATIVO: `command` que falha devolve `false`", async () => {
  const { executarVerificadores } = await R()
  const r = executarVerificadores({
    acceptances: [{ id: "e2e", verifier: { kind: "command", ref: "npm test" } }],
    exec: () => { throw new Error("exit 1") },
  })
  assert.deepEqual(r, { e2e: false })
})

test("método SEM runner fica fora do mapa, e sai NOMEADO em vez de escondido", async () => {
  const { executarVerificadores, semRunner, METODOS_EXECUTAVEIS } = await R()
  const acceptances = [{ id: "login", verifier: { kind: "playwright", ref: "e2e/login.spec.ts" } }]
  assert.deepEqual(executarVerificadores({ acceptances }), {},
    "método que ninguém executa não sustenta entrega")
  assert.deepEqual(semRunner(acceptances), [{ id: "login", kind: "playwright" }])
  assert.deepEqual([...METODOS_EXECUTAVEIS].sort(), ["command", "gate"])
})

test("aceite PENDENTE ou sem verifier nunca entra no mapa", async () => {
  const { executarVerificadores } = await R()
  assert.deepEqual(executarVerificadores({
    acceptances: [
      { id: "a", pending_verifier: { reason: "sem journey" } },
      { id: "b" },
    ],
    verifyReport: relatorio([{ id: "lint", status: "passed" }]),
  }), {})
})

// ── A ponta a ponta com o produto real ─────────────────────────────────────

/**
 * TODO gate citado por um aceite de baseline precisa ter mapeamento.
 *
 * Sem mapeamento, o aceite fica eternamente `unverified` e ninguém descobre por
 * quê — foi o defeito REAL da primeira versão deste runner, que mapeava `qg`,
 * um id de step que não existe. O `verify` continuava verde, o aceite continuava
 * sem resultado, e o silêncio era idêntico ao de um gate que reprovou.
 *
 * Os refs vêm do FONTE do brief (`INFRA_ACCEPTANCES` não é exportado), e não de
 * uma lista repetida aqui: uma cópia divergiria calada no dia em que alguém
 * acrescentasse um aceite de infraestrutura.
 */
test("todo gate citado pelos aceites de infraestrutura do brief REAL tem mapeamento", async () => {
  const { STEP_DO_GATE } = await R()
  const { readFileSync } = await import("node:fs")
  const fonte = readFileSync(path.join(repoRoot, "src", "project-plan", "product-brief.js"), "utf-8")
  const refs = [...fonte.matchAll(/kind:\s*"gate",\s*ref:\s*"([^"]+)"/g)].map((m) => m[1])
  assert.ok(refs.length >= 3, `esperava os aceites de infraestrutura no fonte, achei ${refs.length}`)
  for (const ref of refs) {
    assert.ok(STEP_DO_GATE[ref], `aceite de baseline cita o gate '${ref}' e o runner não sabe resolvê-lo`)
  }
})
