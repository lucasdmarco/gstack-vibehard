import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("handoff: resumo acionável com erros persistentes, pendências e arquivos — sem secrets", async () => {
  const { renderTaskHandoff } = await imp("src/project-plan/journal.js")
  const entries = [
    { step: "scaffold", status: "proved", result: "ok" },
    { step: "build", status: "failed", result: "erro de compilação em app.ts" },
    { step: "test", status: "pending", result: "não rodado" },
  ]
  const md = renderTaskHandoff({ taskId: "tk1", objective: "checkout", entries, attempts: 3, reason: "hard_cap", files: ["src/app.ts"] })
  assert.match(md, /Handoff — task tk1/)
  assert.match(md, /motivo da parada: \*\*hard_cap\*\*/)
  assert.match(md, /Erros persistentes/)
  assert.match(md, /erro de compilação em app\.ts/)
  assert.match(md, /Ainda pendente/)
  assert.match(md, /Arquivos tocados/)
  assert.match(md, /src\/app\.ts/)
  assert.match(md, /task resume tk1/)
  // não vaza secret: o render não inventa nada além dos recibos (já redigidos)
  assert.ok(!/ghp_/.test(md))
})

test("writeTaskHandoff persiste handoff.md no dir da task", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ho-"))
  try {
    const { writeTaskHandoff } = await imp("src/project-plan/journal.js")
    const p = writeTaskHandoff(cwd, "tk2", { objective: "x", entries: [{ step: "a", status: "failed", result: "falhou" }], attempts: 1, reason: "blocked" })
    const md = await readFile(p, "utf-8")
    assert.match(md, /task tk2/)
    assert.match(md, /blocked/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test("loop incompleto entrega handoff.md; loop provado NÃO gera handoff", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ho-"))
  try {
    const { runEvidenceLoop } = await imp("src/project-plan/evidence-loop.js")
    const bad = runEvidenceLoop({
      cwd, taskId: "b", objective: "o", steps: [{ id: "x" }],
      runStep: () => ({ status: "failed", source: "test", result: "quebrou", resumable: false }),
    })
    assert.equal(bad.status, "handoff")
    assert.ok(bad.handoffPath)

    const good = runEvidenceLoop({
      cwd, taskId: "g", objective: "o", steps: [{ id: "x" }],
      runStep: () => ({ status: "proved", source: "verify" }),
    })
    assert.equal(good.status, "complete")
    assert.equal(good.handoffPath, undefined)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
