import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

async function projectFixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-scout-"))
  await mkdir(path.join(cwd, "src"), { recursive: true })
  await writeFile(path.join(cwd, "src", "auth.js"), [
    "// módulo de auth",
    "export function login(user, pass) {",
    "  return checkAuth(user, pass)",
    "}",
    "",
    "function checkAuth(u, p) { return u === 'admin' }",
  ].join("\n"))
  await writeFile(path.join(cwd, "src", "billing.js"), "export function charge() { return 42 }\n")
  // secrets que o scout NUNCA pode ler
  await writeFile(path.join(cwd, ".env"), "AUTH_SECRET=super-secreto-auth-token\n")
  await mkdir(path.join(cwd, "secrets"), { recursive: true })
  await writeFile(path.join(cwd, "secrets", "auth-key.pem"), "-----BEGIN PRIVATE KEY----- auth\n")
  return cwd
}

test("scout: devolve paths+linhas com reason/confidence — nunca conteúdo bruto", async () => {
  const cwd = await projectFixture()
  try {
    const { scout } = await imp("src/context-docs/scout.js")
    const r = scout({ cwd, question: "como o auth funciona?" })
    assert.equal(r.ok, true)
    assert.deepEqual(r.keywords, ["auth"], "stopwords pt removidas")
    const hit = r.results.find((x) => x.file === "src/auth.js")
    assert.ok(hit, "achou o módulo de auth")
    assert.ok(Number.isInteger(hit.lineStart) && hit.lineEnd >= hit.lineStart)
    assert.match(hit.reason, /auth/)
    assert.ok(hit.confidence > 0 && hit.confidence <= 1)
    // nunca despeja conteúdo: payload não contém o corpo do arquivo
    assert.ok(!JSON.stringify(r).includes("u === 'admin'"), "sem dump de código")
    assert.ok(r.tokensAvoided.estimate >= 0)
    assert.match(r.tokensAvoided.basis, /heurística/)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("scout: DENYLIST — .env* e secrets/ NUNCA aparecem nem são lidos", async () => {
  const cwd = await projectFixture()
  try {
    const { scout, isDeniedPath } = await imp("src/context-docs/scout.js")
    const r = scout({ cwd, question: "auth secret token" })
    assert.ok(!r.results.some((x) => /\.env|secrets\//.test(x.file)), "nenhum hit em secret")
    assert.ok(!JSON.stringify(r).includes("super-secreto"), "valor de secret nunca vaza")
    // unidade da denylist
    for (const p of [".env", ".env.local", "config/.env.production", "secrets/x.txt", "a/id_rsa", "k.pem", "node_modules/x.js", ".gstack/state.jsonl",
      // curadoria Replit (S42.0E): portadores de credencial antes descobertos
      ".npmrc", "app/.npmrc", ".netrc", ".git-credentials", ".pgpass", "infra/terraform.tfstate", "state.tfstate.backup", ".aws/credentials"]) {
      assert.equal(isDeniedPath(p), true, `negado: ${p}`)
    }
    // CONTROLE NEGATIVO: fontes legítimas de código NÃO são negadas
    assert.equal(isDeniedPath("src/auth.js"), false)
    assert.equal(isDeniedPath("src/npmrc-helper.js"), false)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("scout: graphify backend usa graph.json quando existe (source_file/L ranges)", async () => {
  const cwd = await projectFixture()
  try {
    await mkdir(path.join(cwd, "graphify-out"), { recursive: true })
    await writeFile(path.join(cwd, "graphify-out", "graph.json"), JSON.stringify({
      nodes: [
        { label: "checkAuth", norm_label: "checkauth", source_file: "src/auth.js", source_location: "L6" },
        { label: "secretNode", norm_label: "auth", source_file: ".env", source_location: "L1" }, // denylist!
      ],
    }))
    const { graphifyBackend } = await imp("src/context-docs/scout.js")
    const g = graphifyBackend(cwd, ["checkauth"])
    assert.equal(g.available, true)
    assert.equal(g.results[0].file, "src/auth.js")
    assert.equal(g.results[0].lineStart, 6)
    // nó apontando para secret é filtrado
    const g2 = graphifyBackend(cwd, ["auth"])
    assert.ok(!g2.results.some((x) => x.file === ".env"), "denylist vale também no graphify")
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("scout: pergunta só de stopwords → erro honesto; mergeLines agrupa", async () => {
  const { scout, mergeLines } = await imp("src/context-docs/scout.js")
  const r = scout({ cwd: "/x", question: "como isso funciona?" })
  assert.equal(r.ok, false)
  assert.deepEqual(mergeLines([1, 2, 3, 10, 11, 30]), [{ start: 1, end: 3 }, { start: 10, end: 11 }, { start: 30, end: 30 }])
})

test("context scout --json: stdout é JSON PURO; fastcontext sem opt-in é recusado", async () => {
  const cwd = await projectFixture()
  try {
    const { contextCommand } = await imp("src/commands/context.js")
    let out = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out += s; return true }
    try { await contextCommand(["scout", "como o auth funciona?", "--json"], { cwd }) }
    finally { process.stdout.write = orig }
    const parsed = JSON.parse(out.trim())
    assert.equal(parsed.ok, true)
    assert.ok(parsed.results.length > 0)
    assert.equal(parsed.modelRouting.tier, "cheap", "explore roteia p/ cheap")
    assert.equal(parsed.modelRouting.fallback, "local_deterministic", "sem modelo configurado → local")

    // FastContext remoto: recusado sem opt-in (nunca chamada de rede silenciosa)
    out = ""
    process.stdout.write = (s) => { out += s; return true }
    try { await contextCommand(["scout", "auth", "--backend", "fastcontext", "--json"], { cwd }) }
    finally { process.stdout.write = orig }
    const refused = JSON.parse(out.trim())
    assert.equal(refused.ok, false)
    assert.match(refused.error, /opt-in/)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})

test("pipeline: projeto EXISTENTE → estágio scout roda de verdade (ready + hits)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "gstack-scoutpipe-"))
  try {
    const proj = path.join(cwd, "app")
    await mkdir(path.join(proj, "src"), { recursive: true })
    await writeFile(path.join(proj, "src", "auth.js"), "export function auth() {}\n")
    const { runPipeline } = await imp("src/project-plan/run-loop.js")
    const { buildPlan } = await imp("src/project-plan/planner.js")
    const { plan } = buildPlan({ objective: "melhorar o auth do app", projectName: "app", mode: "lite" })
    const r = runPipeline({
      plan, planDir: path.join(cwd, ".gstack", "plans", plan.id), cwd,
      exec: () => {}, verifyRunner: () => ({ status: "ready", usable: true, failed: [] }),
    })
    assert.equal(r.stages.scout.status, "ready")
    assert.match(r.stages.scout.detail, /hit\(s\) locais/)
    assert.match(r.stages.scout.detail, /tokens evitados/)
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
})
