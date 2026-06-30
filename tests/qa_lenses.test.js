import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const mod = path.resolve(import.meta.dirname, "..", "src", "project-plan", "qa-lenses.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("lentes pegam os anti-padrões do ultracode (eval/any/bare-except/query/shell)", async () => {
  const { scanFileLenses } = await imp()
  assert.ok(scanFileLenses("a.js", "const r = eval(input)").some((f) => f.id === "eval" && f.severity === "ALTO"))
  assert.ok(scanFileLenses("a.ts", "function f(x: any) {}").some((f) => f.id === "any-type"))
  assert.ok(scanFileLenses("a.ts", "const y = z as any").some((f) => f.id === "any-type"))
  assert.ok(scanFileLenses("a.py", "try:\n    x()\nexcept:\n    pass").some((f) => f.id === "bare-except"))
  assert.ok(scanFileLenses("a.js", "await db.user.findMany()").some((f) => f.id === "unbounded-query"))
  assert.ok(scanFileLenses("a.js", "execSync(`rm ${userInput}`)").some((f) => f.id === "shell-exec"))
  assert.ok(scanFileLenses("a.js", "spawn(c, a, { shell: true })").some((f) => f.id === "shell-true"))
  assert.ok(scanFileLenses("a.js", "const f = new Function('return 1')").some((f) => f.id === "new-function"))
})

// ── ABUSO inverso: NÃO pode dar falso-positivo em código limpo / fora de escopo ──
test("sem falso-positivo: código limpo, linguagem fora de escopo, e arquivos de TESTE", async () => {
  const { scanFileLenses } = await imp()
  assert.deepEqual(scanFileLenses("a.js", "const x = 1\nfunction ok() { return evaluate(x) }"), [], "evaluate != eval(")
  assert.deepEqual(scanFileLenses("a.ts", "const x: string = 'any'"), [], "'any' em string não é tipo any")
  assert.deepEqual(scanFileLenses("a.py", "try:\n    x()\nexcept ValueError:\n    pass"), [], "except específico é ok")
  assert.deepEqual(scanFileLenses("readme.md", "use eval() with care"), [], "markdown fora de escopo")
  assert.deepEqual(scanFileLenses("tests/a.test.js", "const r = eval('1')"), [], "fixtures de teste não disparam")
})

test("evaluateQa: ALTO bloqueia sempre; MÉDIO só em strict; agrupa por lente", async () => {
  const { evaluateQa } = await imp()
  assert.equal(evaluateQa([{ severity: "ALTO", lens: "security" }]).blocked, true)
  assert.equal(evaluateQa([{ severity: "MEDIO", lens: "types" }]).blocked, false, "médio não bloqueia por padrão")
  assert.equal(evaluateQa([{ severity: "MEDIO", lens: "types" }], { strict: true }).blocked, true)
  const g = evaluateQa([{ severity: "ALTO", lens: "security" }, { severity: "MEDIO", lens: "security" }])
  assert.equal(g.byLens.security, 2)
  assert.equal(evaluateQa([]).verdict, "LIMPO")
})

// ── comando qa com files injetados (sem git): bloqueia em ALTO ──
test("qaCommand --json: gate bloqueia (exitCode) com finding ALTO", async () => {
  const { qaCommand } = await import(`${pathToFileURL(path.resolve(import.meta.dirname, "..", "src", "commands", "qa.js"))}?t=${Date.now()}`)
  let buf = ""
  const orig = process.stdout.write.bind(process.stdout)
  const prevCode = process.exitCode
  process.stdout.write = (s) => { buf += String(s); return true }
  try {
    qaCommand(["--json"], { cwd: "/x", files: [{ rel: "src/h.js", content: "const r = eval(x)\n" }] })
  } finally { process.stdout.write = orig }
  const out = JSON.parse(buf.trim())
  assert.equal(out.blocked, true)
  assert.ok(out.findings.some((f) => f.id === "eval"))
  process.exitCode = prevCode // não polui o runner
})
