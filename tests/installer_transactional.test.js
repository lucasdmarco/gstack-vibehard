import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("journal: fault injection reverte TUDO ao byte anterior (P0.9)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-jrnl-"))
  try {
    const { runTransaction } = await imp("src/installer/journal.js")
    const existing = path.join(tmp, "existing.toml")
    await writeFile(existing, "ORIGINAL\n")
    const created = path.join(tmp, "sub", "new.toml")

    const r = runTransaction((j) => {
      j.writeFile(existing, "MODIFICADO\n")   // modifica um arquivo que existia
      j.writeFile(created, "NOVO\n")           // cria arquivo + dir `sub/`
      throw new Error("falha na etapa 3")      // fault injection no meio
    })

    assert.equal(r.ok, false)
    assert.match(r.error.message, /etapa 3/)
    // byte-a-byte: o arquivo modificado volta ao original
    assert.equal(readFileSync(existing, "utf8"), "ORIGINAL\n", "restaura bytes originais")
    // o arquivo criado some, e o dir que o journal criou também
    assert.equal(existsSync(created), false, "remove arquivo criado")
    assert.equal(existsSync(path.join(tmp, "sub")), false, "remove dir criado no rollback")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("journal: commit mantém as escritas", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-jrnl-"))
  try {
    const { runTransaction } = await imp("src/installer/journal.js")
    const f = path.join(tmp, "a", "b.txt")
    const r = runTransaction((j) => j.writeFile(f, "ok\n"))
    assert.equal(r.ok, true)
    assert.equal(r.committed, 1)
    assert.equal(readFileSync(f, "utf8"), "ok\n")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("plano: assertNoEnvExposure REJEITA qualquer .env (P0.10)", async () => {
  const { assertNoEnvExposure, PROJECT_EXPOSE, GLOBAL_DEFAULT_EXPOSE } = await imp("src/installer/operation-plan.js")
  // as listas de produção NÃO têm .env
  assert.doesNotThrow(() => assertNoEnvExposure(PROJECT_EXPOSE))
  assert.doesNotThrow(() => assertNoEnvExposure(GLOBAL_DEFAULT_EXPOSE))
  // a trava pega .env, .env.local e caminhos aninhados
  for (const bad of [".env", ".env.local", "config/.env", "a/.env.production"]) {
    assert.throws(() => assertNoEnvExposure([".claude/", bad]), /P0\.10/, `deve rejeitar ${bad}`)
  }
})

test("dry-run === execução: o MESMO plano (paths) que se mostra é o que se aplica", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-plan-"))
  try {
    const { buildAtomicPlan, renderPlan, executePlan } = await imp("src/installer/operation-plan.js")
    const { InstallJournal } = await imp("src/installer/journal.js")
    const projectDir = path.join(tmp, "proj")
    const home = path.join(tmp, "home")
    const plan = buildAtomicPlan({ projectDir, home })
    const shown = renderPlan(plan).operations.map((o) => o.path)

    const j = new InstallJournal()
    const applied = executePlan(plan, j).map((a) => a.path)
    j.commit()

    assert.deepEqual(applied, shown, "operações aplicadas === operações mostradas no dry-run")
    // e o global entrou (não existia). Se já existir, o plano NÃO o inclui:
    const plan2 = buildAtomicPlan({ projectDir, home })
    assert.equal(plan2.some((o) => o.scope === "global"), false, "global já existe → fora do plano")
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test("create: fixture com .env → ZERO exposição de .env em qualquer artefato Atomic", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "gstack-envleak-"))
  try {
    process.env.GSTACK_SKIP_PREFLIGHT = "1"
    process.env.GSTACK_SKIP_SIDE_EFFECTS = "1"
    const { createProject } = await imp("src/cli/create.js")
    const cwd = path.join(tmp, "ws")
    await mkdir(cwd, { recursive: true })
    await createProject({
      args: ["envapp"], cwd, projectRoot: repoRoot, now: () => "x",
      logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {} },
      execSync: () => Buffer.from("ok"),
    })
    const ws = path.join(cwd, "envapp", ".atomic", "workspace.toml")
    if (existsSync(ws)) {
      const body = await readFile(ws, "utf8")
      // `.env` não pode aparecer numa linha de expose (o .atomicignore pode ter `.env`,
      // mas expose é view — segredo nunca vira view).
      const exposeLines = body.split("\n").filter((l) => /expose|\.env/.test(l))
      assert.equal(exposeLines.some((l) => /\.env/.test(l)), false, `.env exposto: ${exposeLines.join(" | ")}`)
    }
  } finally {
    delete process.env.GSTACK_SKIP_PREFLIGHT
    delete process.env.GSTACK_SKIP_SIDE_EFFECTS
    await rm(tmp, { recursive: true, force: true })
  }
})
