import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.1 — Action Checkpoint Kernel: 3 níveis bounded, ledger sem prompt/segredo,
// step-close NUNCA roda a suíte por edição.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("preAction: segredo no payload → deny (secret-deny-gate)", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  const r = preAction({ tool: "write", content: 'api_key = "fixture-secret-value-not-real"' }, {})
  assert.equal(r.decision, "deny")
  assert.ok(r.checks.find((c) => c.name === "secrets" && c.level === "deny"))
  assert.ok(r.gatesExecuted.includes("secrets"))
})

test("preAction: comando destrutivo → deny; comando seguro → allow", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  assert.equal(preAction({ tool: "bash", command: "rm -rf / " }, {}).decision, "deny")
  assert.equal(preAction({ tool: "bash", command: "git push origin main --force" }, {}).decision, "deny")
  assert.equal(preAction({ tool: "bash", command: "npm run build" }, {}).decision, "allow")
})

test("preAction: escrita fora do workspace → deny (scope-guard)", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  const root = process.platform === "win32" ? "C:\\proj" : "/proj"
  const outside = process.platform === "win32" ? "C:\\Users\\me\\.bashrc" : "/home/me/.bashrc"
  const deny = preAction({ tool: "write", files: [outside] }, { root })
  assert.equal(deny.decision, "deny")
  assert.ok(deny.checks.find((c) => c.name === "scope" && c.level === "deny"))
  // ".." que escapa também é pego
  assert.equal(preAction({ tool: "write", files: ["../../etc/passwd"] }, { root }).decision, "deny")
  // dentro da raiz (arquivo não-UI) → allow
  assert.equal(preAction({ tool: "write", files: ["packages/shared/util.ts"] }, { root, planApproved: true }).decision, "allow")
})

test("preAction: código sem plano → warn; com requirePlan → deny; aprovado → pass", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  assert.equal(preAction({ files: ["src/x.ts"] }, {}).decision, "warn")
  assert.equal(preAction({ files: ["src/x.ts"] }, { requirePlan: true }).decision, "deny")
  const ok = preAction({ files: ["src/x.ts"] }, { planApproved: true })
  assert.equal(ok.decision, "allow")
  assert.ok(ok.checks.find((c) => c.name === "plan" && c.level === "pass"))
})

test("preAction: UI sem design (evaluateDesign.blocked) → deny; resolvido → allow", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  const uiAction = { files: ["apps/web/src/components/Card.tsx"] }
  const blocked = preAction(uiAction, { planApproved: true, evaluateDesign: () => ({ blocked: true, reason: "sem DS" }) })
  assert.equal(blocked.decision, "deny")
  assert.ok(blocked.checks.find((c) => c.name === "design" && c.level === "deny"))
  const ok = preAction(uiAction, { planApproved: true, evaluateDesign: () => ({ blocked: false }) })
  assert.equal(ok.decision, "allow")
})

test("preAction: gatesExecuted lista SÓ as checagens aplicáveis (não as declaradas)", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  // só um comando seguro: roda destructive (e secrets, pois há texto), não plan/design/scope
  const r = preAction({ tool: "bash", command: "ls -la" }, {})
  assert.deepEqual(r.gatesExecuted.sort(), ["destructive", "secrets"])
})

test("postAction: recibo redige segredo e NÃO carrega o conteúdo cru (só digests)", async () => {
  const { postAction } = await imp("src/skills/action-kernel.js")
  const action = { tool: "write", harness: "claude", files: ["a.ts"], content: "token=ghp_012345678901234567890123456789012345XY" }
  const rec = postAction(action, { exitCode: 0, summary: "wrote token=ghp_012345678901234567890123456789012345XY to a.ts" })
  assert.ok(!JSON.stringify(rec).includes("ghp_0123456789"), "segredo não pode aparecer no recibo")
  assert.ok(!("content" in rec), "recibo não carrega conteúdo bruto")
  assert.match(rec.inputDigest, /^sha256:/)
  assert.equal(rec.ok, true)
})

test("classifyDiff: prioridade migration>frontend>backend>test>config>docs", async () => {
  const { classifyDiff } = await imp("src/skills/action-kernel.js")
  assert.equal(classifyDiff(["packages/db/migrations/0001_init.sql"]).primary, "migration")
  assert.equal(classifyDiff(["apps/web/src/components/Card.tsx", "README.md"]).primary, "frontend")
  assert.equal(classifyDiff(["apps/api/routes/users.ts"]).primary, "backend")
  assert.equal(classifyDiff(["docs/guide.md"]).primary, "docs")
})

test("stepClose: escolhe a checagem pelo tipo e NUNCA roda a suíte inteira", async () => {
  const { stepClose } = await imp("src/skills/action-kernel.js")
  const sc = stepClose(["apps/web/src/components/Card.tsx", "packages/db/migrations/0001.sql"])
  assert.equal(sc.ranFullSuite, false)
  const names = sc.checks.map((c) => c.name)
  assert.ok(names.includes("incremental-tests"), "código → testes incrementais")
  assert.ok(names.includes("visual-evidence"), "UI → evidência de navegador")
  assert.ok(names.includes("migration-present"), "schema → migration")
  assert.ok(!names.includes("full-suite"))
})

test("recordAction/readActions: ledger reconstrói o que rodou, sem campo proibido nem segredo", async () => {
  const { recordAction, readActions, buildActionRecord } = await imp("src/skills/action-kernel.js")
  const root = await mkdtemp(path.join(tmpdir(), "gstack-kernel-"))
  try {
    const entry = buildActionRecord({
      action: { tool: "write", harness: "claude", files: ["src/a.ts"], writesCode: true },
      ctx: { planApproved: true, root },
      result: { exitCode: 0, summary: "ok" },
    })
    // injeta campos proibidos de propósito — devem sumir
    recordAction({ root, runId: "r1", entry: { ...entry, prompt: "texto secreto do usuário", token: "ghp_x" } })
    recordAction({ root, runId: "r1", entry: buildActionRecord({ action: { tool: "bash", command: "rm -rf /" }, ctx: {}, result: { exitCode: 1 } }) })

    const p = path.join(root, ".gstack", "runs", "r1", "actions.jsonl")
    assert.ok(existsSync(p))
    const raw = readFileSync(p, "utf-8")
    assert.ok(!raw.includes("prompt"), "campo prompt não pode ir ao ledger")
    assert.ok(!raw.includes("texto secreto"), "conteúdo do prompt não pode vazar")

    const actions = readActions({ root, runId: "r1" })
    assert.equal(actions.length, 2)
    assert.equal(actions[0].decision, "allow")
    assert.equal(actions[0].tool, "write")
    assert.equal(actions[1].decision, "deny", "rm -rf / registrado como deny")
    assert.ok(actions.every((a) => Array.isArray(a.gatesExecuted)))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("DoD p95 < 250ms sem rede: 300 pre-actions ficam MUITO abaixo do budget", async () => {
  const { preAction } = await imp("src/skills/action-kernel.js")
  const action = { tool: "write", harness: "claude", files: ["apps/web/src/ui/Card.tsx", "apps/api/routes/x.ts"], command: "npm run build", writesCode: true }
  const ctx = { root: process.cwd(), planApproved: false, designResolved: true }
  const samples = []
  for (let i = 0; i < 300; i++) { const t = performance.now(); preAction(action, ctx); samples.push(performance.now() - t) }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.ceil(0.95 * samples.length) - 1]
  assert.ok(p95 < 250, `p95=${p95}ms deve ser < 250ms`)
})

test("CLI actions bench --json: ok:true e p95 dentro do budget", async () => {
  const { actionsCommand } = await imp("src/commands/actions.js")
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await actionsCommand(["bench", "--iters", "50", "--json"]) } finally { process.stdout.write = orig }
  const parsed = JSON.parse(out.trim().split("\n").pop())
  assert.equal(parsed.schemaVersion, "gstack.action-kernel.v1")
  assert.equal(parsed.ok, true)
  assert.ok(parsed.p95 < 250)
  assert.equal(parsed.network, false)
})

test("CLI actions ledger --json: lê o run gravado e devolve as ações", async () => {
  const { actionsCommand } = await imp("src/commands/actions.js")
  const { recordAction, buildActionRecord } = await imp("src/skills/action-kernel.js")
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-ledger-"))
  try {
    recordAction({ root: cwd, runId: "run-x", entry: buildActionRecord({ action: { tool: "write", files: ["a.ts"] }, ctx: { planApproved: true }, result: { exitCode: 0 } }) })
    let out = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out += s; return true }
    try { await actionsCommand(["ledger", "--run", "run-x", "--json"], { cwd }) } finally { process.stdout.write = orig }
    const parsed = JSON.parse(out.trim().split("\n").pop())
    assert.equal(parsed.runId, "run-x")
    assert.equal(parsed.actions.length, 1)
    assert.equal(parsed.actions[0].tool, "write")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
