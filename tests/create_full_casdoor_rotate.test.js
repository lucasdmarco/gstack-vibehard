import test from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// PRD45 S45.0 — a credencial-padrão `admin/123` do Casdoor é PÚBLICA (demo data
// documentado). IAM no ar com credencial conhecida NÃO é backend seguro: qualquer
// processo local vira admin do IAM. O create passa a ROTACIONAR (não só avisar) e a
// guardar a senha no keychain do SO via Secrets Broker — nunca no repo/state/argv.
// Provado contra Casdoor real: apos a troca, admin/123 -> "password or code is
// incorrect"; senha nova -> "built-in/admin".

const repoRoot = path.resolve(import.meta.dirname, "..")
const modulePath = path.join(repoRoot, "src", "cli", "create.js")
const imp = () => import(`${pathToFileURL(modulePath)}?t=${Date.now()}`)
const mkLogger = (lines) => ({
  info: (m) => lines.push(`info:${m}`), success: (m) => lines.push(`success:${m}`),
  warn: (m) => lines.push(`warn:${m}`), error: (m) => lines.push(`error:${m}`),
})
const okBody = JSON.stringify({ status: "ok" })
const errBody = JSON.stringify({ status: "error", msg: "password or code is incorrect" })

test("senha gerada: entropia criptográfica e nome válido para o broker", async () => {
  const { generateCasdoorPassword, CASDOOR_SECRET_NAME, CASDOOR_DEFAULT_PASSWORD } = await imp()
  const a = generateCasdoorPassword()
  const b = generateCasdoorPassword()
  assert.notEqual(a, b, "CONTROLE NEGATIVO: senha não pode ser determinística")
  assert.ok(a.length >= 32, `senha curta demais: ${a.length}`)
  assert.notEqual(a, CASDOOR_DEFAULT_PASSWORD)
  // O broker exige [A-Za-z_][A-Za-z0-9_]* — um nome com hífen lançaria em runtime.
  assert.match(CASDOOR_SECRET_NAME, /^[A-Za-z_][A-Za-z0-9_]*$/, "nome aceito por assertValidSecretName")
})

test("rotação: grava no keychain ANTES de trocar (nunca deixa senha ativa e perdida)", async () => {
  const { rotateCasdoorCredential } = await imp()
  const order = []
  const status = rotateCasdoorCredential(mkLogger([]), "http://127.0.0.1:8000", "/proj", {
    // login default OK (default ativo) -> set-password OK -> confirm login default FALHA
    exec: (_f, args) => {
      const url = args.find((a) => String(a).startsWith("http")) || ""
      if (url.includes("/api/set-password")) { order.push("rotate"); return Buffer.from(okBody) }
      if (order.includes("rotate")) return null // confirm: admin/123 já não loga
      return Buffer.from(okBody)
    },
    brokerStatus: () => ({ provider: "windows-dpapi", available: true }),
    setSecret: () => { order.push("store") },
    generate: () => "senha-forte-de-teste-123456789",
  })
  assert.equal(status, "rotated")
  assert.deepEqual(order, ["store", "rotate"], "grava no keychain ANTES de trocar (ordem é segurança, não estilo)")
})

test("FAIL-CLOSED: sem keychain, NÃO rotaciona (senão a senha nova se perderia) e avisa", async () => {
  const { rotateCasdoorCredential } = await imp()
  const lines = []
  let stored = false
  const status = rotateCasdoorCredential(mkLogger(lines), "http://127.0.0.1:8000", "/proj", {
    exec: () => Buffer.from(okBody), // admin/123 ativo
    brokerStatus: () => ({ provider: null, available: false }),
    setSecret: () => { stored = true },
    generate: () => "x".repeat(32),
  })
  assert.equal(status, "insecure_default")
  assert.equal(stored, false, "CONTROLE NEGATIVO: nunca troca sem ter onde guardar")
  assert.ok(lines.some((l) => l.startsWith("warn:") && /admin\/123/.test(l)), "avisa que a padrão SEGUE ATIVA")
})

test("FAIL-CLOSED: keychain recusa gravar => aborta a troca e mantém aviso honesto", async () => {
  const { rotateCasdoorCredential } = await imp()
  const lines = []
  let rotated = false
  const status = rotateCasdoorCredential(mkLogger(lines), "http://127.0.0.1:8000", "/proj", {
    exec: (_f, args) => {
      if (String(args.join(" ")).includes("/api/set-password")) { rotated = true }
      return Buffer.from(okBody)
    },
    brokerStatus: () => ({ provider: "windows-dpapi", available: true }),
    setSecret: () => { throw new Error("keychain indisponivel") },
    generate: () => "x".repeat(32),
  })
  assert.equal(status, "insecure_default")
  assert.equal(rotated, false, "CONTROLE NEGATIVO: keychain falhou => NÃO troca")
  assert.ok(lines.some((l) => l.startsWith("warn:") && /keychain/i.test(l)))
})

test("CONTROLE NEGATIVO em produção: admin/123 ainda logando após a troca = rotação NÃO comprovada", async () => {
  const { rotateCasdoorCredential } = await imp()
  const lines = []
  // Tudo responde "ok" — inclusive o login default DEPOIS da troca. Rotação de mentira.
  const status = rotateCasdoorCredential(mkLogger(lines), "http://127.0.0.1:8000", "/proj", {
    exec: () => Buffer.from(okBody),
    brokerStatus: () => ({ provider: "windows-dpapi", available: true }),
    setSecret: () => {},
    generate: () => "x".repeat(32),
  })
  assert.equal(status, "rotation_failed", "não basta a API dizer ok — tem que PROVAR que a padrão morreu")
  assert.ok(lines.some((l) => l.startsWith("warn:") && /AINDA autentica/.test(l)))
  assert.ok(!lines.some((l) => l.startsWith("success:")), "nunca declara sucesso sem prova")
})

test("idempotente: admin/123 já recusado => already_rotated, sem tocar no keychain", async () => {
  const { rotateCasdoorCredential } = await imp()
  let stored = false
  const status = rotateCasdoorCredential(mkLogger([]), "http://127.0.0.1:8000", "/proj", {
    exec: () => Buffer.from(errBody), // login default recusado
    brokerStatus: () => ({ provider: "windows-dpapi", available: true }),
    setSecret: () => { stored = true },
    generate: () => "x".repeat(32),
  })
  assert.equal(status, "already_rotated")
  assert.equal(stored, false, "não regrava/retroca o que já está rotacionado")
})

test("API recusa a troca => rotation_failed (nunca 'rotated' otimista)", async () => {
  const { rotateCasdoorCredential } = await imp()
  const status = rotateCasdoorCredential(mkLogger([]), "http://127.0.0.1:8000", "/proj", {
    exec: (_f, args) => (String(args.join(" ")).includes("/api/set-password") ? Buffer.from(errBody) : Buffer.from(okBody)),
    brokerStatus: () => ({ provider: "windows-dpapi", available: true }),
    setSecret: () => {},
    generate: () => "x".repeat(32),
  })
  assert.equal(status, "rotation_failed")
})

test("a senha NUNCA vai no argv (visível em `ps`) — só por arquivo", async () => {
  const { rotateCasdoorCredential } = await imp()
  const SECRET = "SENHA-SUPER-SECRETA-NAO-PODE-VAZAR-9x"
  const seen = []
  rotateCasdoorCredential(mkLogger([]), "http://127.0.0.1:8000", "/proj", {
    exec: (_f, args) => { seen.push(args.join(" ")); return Buffer.from(okBody) },
    brokerStatus: () => ({ provider: "windows-dpapi", available: true }),
    setSecret: () => {},
    generate: () => SECRET,
  })
  assert.ok(seen.length > 0, "houve chamadas")
  for (const argv of seen) {
    assert.ok(!argv.includes(SECRET), `CONTROLE NEGATIVO: senha vazou no argv -> ${argv.slice(0, 120)}`)
  }
  // Prova o mecanismo: o curl lê a senha de arquivo (`newPassword@...`).
  assert.ok(seen.some((a) => /newPassword@/.test(a)), "usa `--data-urlencode newPassword@arquivo`")
})

test("schema de secrets: Full declara CASDOOR_ADMIN_PASSWORD em required; Lite não", async () => {
  const { buildSecretsSchema, CASDOOR_SECRET_NAME } = await imp()
  const names = (s) => s.required.map((e) => e.name)
  // `secrets run` injeta SÓ os required — em optional o usuário não teria como recuperar.
  assert.ok(names(buildSecretsSchema(false)).includes(CASDOOR_SECRET_NAME), "Full: recuperável via `secrets run`")
  assert.ok(!names(buildSecretsSchema(true)).includes(CASDOOR_SECRET_NAME), "CONTROLE NEGATIVO: Lite não sobe Casdoor")
  // Não regride o que já existia.
  assert.ok(names(buildSecretsSchema(true)).includes("DATABASE_URL"))
  assert.ok(names(buildSecretsSchema(false)).includes("DATABASE_URL"))
})
