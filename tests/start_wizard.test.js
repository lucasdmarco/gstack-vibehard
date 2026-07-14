import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("wizard: objetivo+nome+modo via UI injetada → plano válido com recipe certa", async () => {
  const { runWizard } = await imp("src/project-plan/wizard.js")
  const asked = []
  const ui = {
    prompt: async (q) => { asked.push(q); return q.includes("construir") ? "SaaS com login e Stripe" : "academiapro" },
    select: async () => "Usar recomendado (full)",
  }
  const res = await runWizard(ui, {})
  assert.equal(res.cancelled, false)
  assert.equal(res.validation.ok, true)
  assert.equal(res.plan.intent, "saas-auth-stripe")
  assert.equal(res.plan.mode, "full", "usou o modo recomendado")
  assert.equal(res.plan.projectName, "academiapro")
  assert.ok(asked.length >= 2, "perguntou objetivo e nome")
})

test("wizard: escolha de modo Leve sobrepõe o recomendado", async () => {
  const { runWizard } = await imp("src/project-plan/wizard.js")
  const ui = { prompt: async (q) => q.includes("construir") ? "SaaS com Stripe" : "app", select: async () => "Leve" }
  const res = await runWizard(ui, {})
  assert.equal(res.plan.mode, "lite")
})

test("wizard: sem objetivo → cancelado", async () => {
  const { runWizard } = await imp("src/project-plan/wizard.js")
  const res = await runWizard({ prompt: async () => "", select: async () => "Leve" }, {})
  assert.equal(res.cancelled, true)
})

test("start: executa o plano após confirmação (UI+exec injetados) e persiste", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-start-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const ran = []
    const r = await startCommand([], {
      cwd: tmp,
      objective: "quero um web app fullstack",
      projectName: "loja",
      mode: "lite",
      designSystem: "none", // testa execução do pipeline, não o design-system gate (F2-B)
      confirm: async () => true,
      exec: (c) => ran.push(c.join(" ")),
    })
    assert.equal(r.result.status, "done")
    assert.ok(ran.some((c) => c.includes("create loja") && c.includes("--lite")))
    assert.ok(existsSync(path.join(tmp, ".gstack", "plans", r.plan.id, "plan.json")), "plano persistido")
    // S42.1: Product Brief persistido como artefato vivo (decisões + aceites com verificador/pending)
    const briefPath = path.join(tmp, ".gstack", "plans", r.plan.id, "brief.json")
    assert.ok(existsSync(briefPath), "brief.json persistido")
    const brief = JSON.parse(await (await import("node:fs/promises")).readFile(briefPath, "utf8"))
    assert.equal(brief.schema, "gstack.product-brief.v1")
    assert.ok(brief.acceptances.length >= 3, "brief tem aceites")
    assert.ok(brief.decisions.every((d) => d.source), "toda decisão tem fonte rastreada")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("start: cancelar na confirmação salva o plano mas NÃO executa", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-start2-"))
  try {
    const { startCommand } = await imp("src/commands/start.js")
    const ran = []
    const r = await startCommand([], {
      cwd: tmp, objective: "web app", projectName: "x", mode: "lite",
      confirm: async () => false, exec: (c) => ran.push(c),
    })
    assert.equal(r.executed, false)
    assert.equal(ran.length, 0, "nada executado ao cancelar")
    assert.ok(existsSync(path.join(tmp, ".gstack", "plans", r.plan.id, "plan.json")))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
