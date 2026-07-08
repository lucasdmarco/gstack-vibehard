import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// io fake do classifier: declara só o que EXISTE (resto = false). home fixo.
const io = (existing = [], jsonByPath = {}) => ({
  exists: (p) => existing.some((e) => p.replaceAll("\\", "/").endsWith(e)),
  readJson: (p) => jsonByPath[Object.keys(jsonByPath).find((k) => p.replaceAll("\\", "/").endsWith(k))] ?? null,
  home: "C:/Users/Windows",
})

// ── classifyWorkspace: os 6 estados ──────────────────────────────────────────────
test("classifier: home do usuário sem projeto → home_or_wrong_cwd (o bug real)", async () => {
  const { classifyWorkspace } = await imp("src/runtime/workspace.js")
  const ws = classifyWorkspace("C:/Users/Windows", io([]))
  assert.equal(ws.state, "home_or_wrong_cwd")
  assert.ok(ws.actions.some((a) => a.includes("gstack_vibehard start")), "próxima ação é a trilha GStack")
  assert.ok(!ws.actions.some((a) => /npm install/.test(a)), "NUNCA sugere npm install")
})

test("classifier: .git sem app → empty_git_repo; pasta neutra vazia → empty_dir (não interrompe)", async () => {
  const { classifyWorkspace } = await imp("src/runtime/workspace.js")
  assert.equal(classifyWorkspace("C:/dev/produto", io([".git"])).state, "empty_git_repo")
  assert.equal(classifyWorkspace("C:/dev/playground", io([])).state, "empty_dir")
})

test("classifier: .gstack/app.json OU runtime manifest → gstack_project", async () => {
  const { classifyWorkspace } = await imp("src/runtime/workspace.js")
  assert.equal(classifyWorkspace("C:/dev/x", io([".gstack/app.json"])).state, "gstack_project")
  assert.equal(classifyWorkspace("C:/dev/y", io([".gstack/services.json"])).state, "gstack_project")
})

test("classifier: package.json válido → node_app com scripts; inválido → unknown", async () => {
  const { classifyWorkspace } = await imp("src/runtime/workspace.js")
  const ws = classifyWorkspace("C:/dev/app", io(["package.json"], { "package.json": { scripts: { build: "x" } } }))
  assert.equal(ws.state, "node_app")
  assert.deepEqual(ws.signals.scripts, ["build"])
  assert.equal(classifyWorkspace("C:/dev/bad", io(["package.json"])).state, "unknown", "JSON ilegível = sinais conflitantes")
})

// ── tradutor de erros npm ────────────────────────────────────────────────────────
test("tradutor npm: ENOENT/missing script/npm.ps1/rede → diagnóstico + ação GStack", async () => {
  const { translateNpmError } = await imp("src/runtime/workspace.js")
  const enoent = translateNpmError("npm error code ENOENT ... Could not read package.json: C:\\Users\\Windows\\package.json")
  assert.equal(enoent.id, "enoent_package_json")
  assert.match(enoent.nextAction, /gstack_vibehard start/)
  assert.match(enoent.nextAction, /NÃO rode `npm install`/)
  assert.equal(translateNpmError('npm error Missing script: "dev"').id, "missing_script")
  assert.equal(translateNpmError("npm.ps1 cannot be loaded because running scripts is disabled").id, "ps_execution_policy")
  assert.equal(translateNpmError("request to registry failed ETIMEDOUT").id, "npm_hang_or_network")
  assert.equal(translateNpmError("algo aleatório"), null, "sem tradução inventada")
})

// ── node-health: gate com exec fake ──────────────────────────────────────────────
const fakeExec = (behavior) => (file, argv, opts = {}) => {
  const cmd = [file, ...argv].join(" ")
  for (const [pattern, out] of behavior) {
    if (pattern.test(cmd)) {
      if (out instanceof Error) throw out
      return typeof out === "function" ? out(opts) : out
    }
  }
  throw Object.assign(new Error("not found"), { code: "ENOENT" })
}
const tmpFs = () => {
  const writes = []
  return { writes, mkdtemp: () => "/tmp/fake-smoke", write: (p, c) => writes.push(p.replaceAll("\\", "/")), cleanup: () => {} }
}

test("node-health: trio saudável + smoke em tempdir → ok:true (e NUNCA escreve no home)", async () => {
  const { checkNodeHealth } = await imp("src/installer/node-health.js")
  const fs = tmpFs()
  const h = checkNodeHealth({
    platform: "linux", ...fs,
    exec: fakeExec([
      [/^node --version/, "v24.1.0"],
      [/npm --version/, "11.9.0"],
      [/npx --version/, "11.9.0"],
      [/npm pkg get name/, '"gstack-smoke"'],
      [/npm config get registry/, "https://registry.npmjs.org/"],
    ]),
  })
  assert.equal(h.ok, true, JSON.stringify(h.blockers))
  assert.equal(h.smoke.ok, true)
  assert.equal(h.registry.status, "configured")
  assert.ok(fs.writes.every((p) => p.startsWith("/tmp/fake-smoke")), `smoke só escreve no tempdir: ${fs.writes}`)
})

test("node-health: node OK mas npm quebrado → blocker explica que node não basta", async () => {
  const { checkNodeHealth } = await imp("src/installer/node-health.js")
  const h = checkNodeHealth({
    platform: "linux", ...tmpFs(),
    exec: fakeExec([[/^node --version/, "v24.1.0"], [/npm config/, new Error("x")]]),
  })
  assert.equal(h.ok, false)
  assert.ok(h.blockers.some((b) => /npm.*mesmo com node OK/.test(b)), JSON.stringify(h.blockers))
  assert.equal(h.smoke.detail, "pulado (npm não executável)")
})

test("node-health: node antigo (<18) bloqueia; registry indisponível é degraded (não blocker)", async () => {
  const { checkNodeHealth } = await imp("src/installer/node-health.js")
  const h = checkNodeHealth({
    platform: "linux", ...tmpFs(),
    exec: fakeExec([
      [/^node --version/, "v16.20.0"], [/npm --version/, "9.0.0"], [/npx --version/, "9.0.0"],
      [/npm pkg get name/, '"gstack-smoke"'], [/npm config get registry/, new Error("offline")],
    ]),
  })
  assert.ok(h.blockers.some((b) => /v16.*< mínimo v18/.test(b)))
  assert.equal(h.registry.status, "degraded")
  assert.ok(!h.blockers.some((b) => /registry/i.test(b)), "registry nunca é blocker de ambiente")
})

test("node-health: npm pendurado no smoke → blocker 'pendurado (timeout)' acionável", async () => {
  const { checkNodeHealth } = await imp("src/installer/node-health.js")
  const h = checkNodeHealth({
    platform: "linux", ...tmpFs(),
    exec: fakeExec([
      [/^node --version/, "v24.1.0"], [/npm --version/, "11.9.0"], [/npx --version/, "11.9.0"],
      [/npm pkg get name/, Object.assign(new Error("t"), { code: "ETIMEDOUT" })],
      [/npm config get registry/, "https://registry.npmjs.org/"],
    ]),
  })
  assert.ok(h.blockers.some((b) => /pendurado \(timeout\)/.test(b)), JSON.stringify(h.blockers))
})

test("node-health: no Windows npm/npx via cmd.exe (npm.ps1 bloqueado não derruba)", async () => {
  const { probeNpmNpx } = await imp("src/installer/node-health.js")
  const seen = []
  const r = probeNpmNpx({
    platform: "win32",
    exec: (file, argv) => { seen.push(`${file} ${argv.join(" ")}`); return "11.9.0" },
  })
  assert.equal(r.npmOk, true); assert.equal(r.npxOk, true)
  assert.ok(seen.every((c) => /cmd\.exe \/c (npm|npx) --version/.test(c)), `via cmd.exe: ${seen}`)
})

// ── start: workspace guard ───────────────────────────────────────────────────────
// PRD34 §2.1: o select REAL retorna a STRING da opção — os fakes imitam isso.
test("start no home: pergunta criar/abrir/diagnosticar e NÃO segue quando usuário sai", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const asked = []
  const r = await startCommand([], {
    cwd: "C:/Users/Windows",
    classify: () => ({ state: "home_or_wrong_cwd", description: "home", signals: {}, actions: ["gstack_vibehard start"] }),
    select: async (q, choices) => { asked.push({ q, choices }); return choices.find((c) => /diagnosticar/i.test(c)) }, // contrato real: string
    prompt: async () => { throw new Error("wizard NÃO deve rodar") },
  })
  assert.equal(r.guarded, true)
  assert.equal(r.executed, false)
  assert.equal(asked.length, 1)
  assert.ok(asked[0].choices.some((c) => /diagnosticar/i.test(c)))
})

test("start em repo git vazio: escolha 'scaffold aqui' (STRING do select real) segue para o wizard", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  let wizardRan = false
  await startCommand([], {
    cwd: "C:/dev/produto",
    classify: () => ({ state: "empty_git_repo", description: "git sem app", signals: {}, actions: [] }),
    select: async (q, choices) => choices[0], // "criar scaffold neste diretório" — string, como o select real
    prompt: async () => { wizardRan = true; return "" }, // wizard pede objetivo → cancela vazio
  })
  assert.equal(wizardRan, true, "guard liberou o wizard — era o BUG do contrato índice (v3.80)")
})

test("guard retrocompat: fake numérico legado (índice) continua aceito", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  let wizardRan = false
  await startCommand([], {
    cwd: "C:/dev/produto2",
    classify: () => ({ state: "empty_git_repo", description: "git sem app", signals: {}, actions: [] }),
    select: async () => 0, // índice numérico (legado) — choiceIndex normaliza
    prompt: async () => { wizardRan = true; return "" },
  })
  assert.equal(wizardRan, true)
})

test("start em projeto gstack/pasta neutra: guard NÃO interrompe (zero perguntas extra)", async () => {
  const { startCommand } = await imp("src/commands/start.js")
  const selects = []
  await startCommand([], {
    cwd: "C:/dev/x",
    classify: () => ({ state: "gstack_project", description: "", signals: {}, actions: [] }),
    select: async (q) => { selects.push(q); return 0 },
    prompt: async () => "",
  })
  assert.ok(!selects.some((q) => /O que você quer fazer/.test(q)), "sem pergunta de guard")
})

// ── dev sem manifest: diagnóstico acionável (fonte) ──────────────────────────────
test("dev sem manifest: explica o estado do diretório e nunca sugere npm cru (fonte)", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(path.join(repoRoot, "src", "commands", "runtime-supervisor.js"), "utf-8")
  assert.match(src, /classifyWorkspace/, "usa o classifier")
  assert.match(src, /NUNCA sugere npm cru/, "contrato documentado")
  assert.ok(!/npm install/.test(src), "zero menção a npm install no supervisor")
})

// ── create: next-step contract ───────────────────────────────────────────────────
test("create: NEXT_STEPS.md aponta dev/verify/proof e proíbe npm no home", async () => {
  const { nextStepsContent } = await imp("src/runtime/workspace.js")
  const md = nextStepsContent("meu-app")
  assert.match(md, /cd meu-app/)
  assert.match(md, /gstack_vibehard dev/)
  assert.match(md, /gstack_vibehard proof --json/)
  assert.match(md, /Não rode `npm install` no diretório home/)
})

test("create: writeNextSteps ligado no createProject e summary usa a trilha gstack (fonte)", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(path.join(repoRoot, "src", "cli", "create.js"), "utf-8")
  assert.match(src, /writeNextSteps\(projectDir, c\.projectName, c\.logger\)/)
  assert.match(src, /gstack_vibehard dev\s+# sobe o runtime/)
  assert.ok(!/pnpm dev`?\)$/m.test(src.split("printCreateSummary")[1]?.split("}")[0] || ""), "summary não manda pnpm dev cru")
})

// ── install preflight: npm/npx no gate mandatório (fonte + probe) ────────────────
test("install: MANDATORY_DEP_PROBES inclui runtime npm/npx (Node presente não basta)", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(path.join(repoRoot, "src", "installer", "install.js"), "utf-8")
  assert.match(src, /component: "runtime npm"/)
  assert.match(src, /component: "runtime npx"/)
  assert.match(src, /probeNpmNpx/)
})
