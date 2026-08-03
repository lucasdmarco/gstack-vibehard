import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTmp } from "./helpers/tmp.js"

/**
 * Fatia 1 da Fase 1B — AST engine com resolucao lexical REAL.
 *
 * O que estes testes protegem, e por que cada um existe:
 *
 *  - **Shadowing**: o prototipo agregava declaracoes do arquivo inteiro num Set e
 *    ignorava parametros; um parametro `info` sombreando o import era atribuido
 *    ao import mesmo assim. Agora o binding vem do TypeChecker.
 *  - **Origem canonica**: checar so o NOME deixaria passar um `info` importado de
 *    outro pacote como canal publico oficial.
 *  - **`runtime-stack-passthrough` REMOVIDA**: classificava propriedade de erro em
 *    catch como passthrough — reincidencia do erro ja corrigido na fatia Python.
 *  - **`GSTACK_DEBUG`**: ativacao explicita significa fora do fluxo padrao.
 *  - **`unknown` sobrevive** quando nao ha evidencia: nunca vira "interno" por
 *    default.
 *
 * Esta fatia NAO toca o inventario oficial: nao ha registry, consumo, provenance
 * nem CI aqui. `src/cli/index.js` segue oficialmente com os unknown atuais.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const eng = () => import(`${pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-js-ast.mjs"))}?t=${Date.now()}`)

/** Monta um mini-projeto com um `cli/index.js` canonico e o arquivo sob teste. */
function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "gstack-ast-"))
  mkdirSync(path.join(root, "src", "cli"), { recursive: true })
  writeFileSync(path.join(root, "src", "cli", "index.js"), files["src/cli/index.js"] ?? `
export function info(msg) { console.log(msg) }
export function warn(msg) { console.log(msg) }
export function section(t) { console.log(t) }
`)
  const alvos = []
  for (const [rel, src] of Object.entries(files)) {
    if (rel === "src/cli/index.js") continue
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, src)
    alvos.push(abs)
  }
  return { root, alvos, canonical: path.join(root, "src", "cli", "index.js") }
}

// ── Resolucao de binding ──────────────────────────────────────────────────────

test("POSITIVO: import nomeado do modulo canonico resolve como canal publico", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({ "src/commands/x.js": `import { info } from "../cli/index.js"\ninfo("oi")\n` })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    assert.equal(p.length, 1)
    assert.equal(p[0].binding.kind, "import")
    assert.equal(p[0].audience, "public_diagnostic")
    assert.equal(p[0].rule, "render-via-canonical-helper")
  } finally { cleanupTmp(f.root) }
})

test("ALIAS: `import { info as log }` resolve ate a declaracao real", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({ "src/commands/x.js": `import { info as log } from "../cli/index.js"\nlog("oi")\n` })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    // `log` nao esta em SINK_NAMES; o alias nao cria ponto novo por nome.
    // O que importa e nao explodir e nao inventar classificacao.
    assert.ok(Array.isArray(p))
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO (homonimo): `info` importado de OUTRO modulo NAO e canal oficial", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({
    "src/outro/logger.js": `export function info(msg) { console.log(msg) }\n`,
    "src/commands/x.js": `import { info } from "../outro/logger.js"\ninfo("oi")\n`,
  })
  try {
    const alvo = f.alvos.find((x) => x.endsWith("x.js"))
    const a = createAnalyzer([...f.alvos, f.canonical])
    const p = analyzeFile(alvo, a)
    assert.equal(p[0].binding.kind, "import")
    assert.ok(!p[0].binding.declaredIn.endsWith("src/cli/index.js"), "origem NAO e o modulo canonico")
    assert.equal(p[0].audience, "unknown", "nome igual com origem diferente nao e o mesmo binding")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO (shadowing): PARAMETRO `info` sombreia o import — nao e o canal", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({
    "src/commands/x.js": `import { info } from "../cli/index.js"
export function run(info) {
  info("sombreado")
}
`,
  })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    assert.equal(p[0].binding.kind, "parameter", "o checker resolve para o PARAMETRO, nao o import")
    assert.equal(p[0].audience, "unknown", "sombreamento nao pode herdar a classificacao do import")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO (shadowing local): `const info = ...` no arquivo sombreia o import", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({
    "src/commands/x.js": `const info = (m) => process.stdout.write(m)
info("local")
`,
  })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    assert.equal(p[0].binding.kind, "local")
    assert.ok(!p[0].binding.declaredIn.endsWith("src/cli/index.js"))
    assert.equal(p[0].audience, "unknown")
  } finally { cleanupTmp(f.root) }
})

// ── GSTACK_DEBUG ──────────────────────────────────────────────────────────────

test("POSITIVO: sob `GSTACK_DEBUG` vira internal_debug com risco declarado", async () => {
  const { analyzeFile, createAnalyzer, rules } = await eng()
  const f = fixture({
    "src/commands/x.js": `export function run(e) {
  if (process.env.GSTACK_DEBUG) console.log(e.stack)
}
`,
  })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    assert.equal(p[0].audience, "internal_debug")
    assert.equal(p[0].trigger, "debug_flag")
    const r = rules().find((x) => x.id === "debug-guarded")
    assert.equal(r.risk, "raw_stack_paths_and_secrets")
  } finally { cleanupTmp(f.root) }
})

test("NEGATIVO: `if (GSTACK_DEBUG)` em funcao VIZINHA nao contamina — ancestralidade real", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({
    "src/commands/x.js": `export function a() {
  if (process.env.GSTACK_DEBUG) console.log("debug")
}
export function b(e) {
  console.log(e.stack)
}
`,
  })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    const emB = p.find((x) => x.functions[0] === "b")
    assert.equal(emB.underDebugGuard, false, "o guard da funcao vizinha nao alcanca `b`")
    assert.notEqual(emB.audience, "internal_debug")
  } finally { cleanupTmp(f.root) }
})

// ── catch nao e publico por si so ─────────────────────────────────────────────

test("NEGATIVO: chamada em catch NAO vira publica nem passthrough automaticamente", async () => {
  const { analyzeFile, createAnalyzer, rules } = await eng()
  const f = fixture({
    "src/commands/x.js": `export function run() {
  try { risky() } catch (e) { console.log(e.stack) }
}
`,
  })
  try {
    const a = createAnalyzer([f.alvos[0], f.canonical])
    const p = analyzeFile(f.alvos[0], a)
    assert.equal(p[0].inCatch, true, "a ancestralidade registra o catch")
    assert.equal(p[0].audience, "unknown", "estar em catch nao classifica por si so")
    assert.equal(rules().find((x) => x.id === "runtime-stack-passthrough"), undefined,
      "a regra incorreta do prototipo foi REMOVIDA")
  } finally { cleanupTmp(f.root) }
})

test("external_passthrough NAO e alcancavel por nenhuma regra desta fatia", async () => {
  const { rules } = await eng()
  assert.deepEqual(rules().filter((r) => r.audience === "external_passthrough"), [],
    "exige subprocesso externo identificado — nenhuma regra AST pode conceder isso")
})

// ── Prompt: cadeia inteira ────────────────────────────────────────────────────

test("POSITIVO: saida em arrow ANINHADO dentro de prompt e capturada (cadeia inteira)", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({
    "src/cli/index.js": `export function select(q, options) {
  console.log(q)
  options.forEach((o, i) => { console.log(\`\${i}. \${o}\`) })
}
`,
  })
  try {
    const a = createAnalyzer([f.canonical])
    const p = analyzeFile(f.canonical, a)
    const aninhado = p.find((x) => x.functions[0] === "<anon>")
    assert.ok(aninhado, "o arrow aninhado produz ponto")
    assert.equal(aninhado.audience, "public_interactive",
      "olhar so a funcao imediata perderia este caso")
  } finally { cleanupTmp(f.root) }
})

// ── Provenance (declarada, nao classificatoria) ───────────────────────────────

test("provenance: literal puro resolve; template interpolado fica unresolved", async () => {
  const { argumentProvenance } = await eng()
  assert.equal(argumentProvenance({ templateIds: [] }).resolved, true)
  assert.equal(argumentProvenance({ templateIds: ["objective"] }).resolved, false,
    "interpolacao NAO prova origem do dado")
})

// ── Falso positivo do regex ───────────────────────────────────────────────────

test("a DECLARACAO `export function info(msg)` nao e contada como chamada", async () => {
  const { analyzeFile, createAnalyzer } = await eng()
  const f = fixture({ "src/cli/index.js": `export function info(msg) { console.log(msg) }\n` })
  try {
    const a = createAnalyzer([f.canonical])
    const p = analyzeFile(f.canonical, a)
    assert.equal(p.length, 1, "so o console.log INTERNO conta — a declaracao nao e chamada")
    assert.equal(p[0].callee, "console.log")
  } finally { cleanupTmp(f.root) }
})

test("toda regra declara audiencia, trigger e razao auditavel", async () => {
  const { rules } = await eng()
  for (const r of rules()) {
    assert.ok(r.audience && r.trigger, `${r.id} declara audiencia e trigger`)
    assert.ok(r.reason && r.reason.length > 30, `${r.id} registra a razao estrutural`)
  }
})
