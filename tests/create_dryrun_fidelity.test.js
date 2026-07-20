import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.5 (P1.8) — `create --full --dry-run` omitia os efeitos reais: listava basicamente
// o projeto e ~/.atomic, mas o caminho real provisiona Docker/Casdoor (container + rede + volume),
// ECC, AgentMemory, etc. Consentimento informado FALSO. Correção: dry-run e executor consomem o
// MESMO operation plan; o dry-run descreve cada op (arquivo/comando/rede/pacote/versão/escopo/
// rollback/motivo) sem executar nada.

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")
const imp = () => import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
const silent = { info: () => {}, success: () => {}, warn: () => {}, error: () => {} }

async function dryRun(args) {
  const { createProject } = await imp()
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-dry-"))
  const cwd = path.join(tmp, "ws"); await mkdir(cwd, { recursive: true })
  try {
    const capture = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { capture.push(String(s)); return true }
    let report
    try { report = await createProject({ args: [...args, "--dry-run", "--json"], cwd, projectRoot: repoRoot, now: () => "x", logger: silent }) }
    finally { process.stdout.write = orig }
    return { report, out: capture.join("") }
  } finally { await rm(tmp, { recursive: true, force: true }) }
}

test("dry-run FULL: expõe as operações reais com rede/escopo/rollback (consentimento informado)", async () => {
  const { report } = await dryRun(["app", "--full"])
  assert.ok(Array.isArray(report.operations), "dry-run traz o operation plan")
  const casdoor = report.operations.find((o) => /casdoor/i.test(o.id) || /casdoor/i.test(o.description))
  assert.ok(casdoor, "o dry-run MOSTRA o Casdoor (antes omitido)")
  assert.equal(casdoor.kind, "container", "declara que é um container Docker")
  assert.ok(casdoor.network, "expõe o efeito de REDE (porta/loopback)")
  assert.ok(casdoor.rollback && casdoor.rollback !== "sem rollback", "cada op declara como é revertida")
  assert.ok(casdoor.scope, "escopo declarado")
  // controle negativo: nada foi escrito/executado.
  assert.match(report.note || "", /nada|dry/i)
})

test("dry-run LITE: sem operações de container/global (Lite não suja a máquina)", async () => {
  const { report } = await dryRun(["app"])
  const ops = report.operations || []
  assert.ok(!ops.some((o) => o.kind === "container"), "CONTROLE NEGATIVO: Lite não provisiona container")
  assert.ok(!ops.some((o) => o.scope === "global"), "Lite não escreve global")
})

test("buildFullProvisionPlan: fonte ÚNICA — descreve container com digest fixado e loopback", async () => {
  const { buildFullProvisionPlan } = await imp()
  const ops = buildFullProvisionPlan({ projectName: "demo", projectDir: "/tmp/demo" })
  const casdoor = ops.find((o) => o.kind === "container")
  assert.ok(casdoor, "plano inclui o container Casdoor")
  assert.match(casdoor.package || "", /casbin\/casdoor/, "pacote/imagem declarada")
  assert.match(casdoor.version || "", /sha256:/, "versão por DIGEST (não latest)")
  assert.match(casdoor.network || "", /127\.0\.0\.1/, "rede em loopback")
  assert.ok(typeof casdoor.compensate === "function", "op tem compensador real (rollback automático)")
})
