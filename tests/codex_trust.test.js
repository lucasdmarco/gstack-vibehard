import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

/**
 * PRD51 S51.7.7 — cenário 6 do PRD49: "hook do Codex não-confiável reporta
 * aguardando aprovação".
 *
 * Estava `not_executed` porque o repo assumia que não existia nenhum conceito
 * real de "ambiente confiável". Existe — e é do PRÓPRIO Codex CLI, não nosso:
 * `~/.codex/config.toml` tem uma tabela `[hooks.state]` cujas chaves são
 * `<arquivo>:<evento>:<grupo>:<hook>` e cujo valor é `trusted_hash`, o registro
 * de que o usuário aprovou aquele hook.
 *
 * LIMITE HONESTO travado por teste: a entrada exata do sha256 é interna do
 * Codex e não documentada (5 candidatos plausíveis testados contra hashes
 * reais, nenhum bateu). O módulo NUNCA recomputa o hash — `recorded` significa
 * "aprovou alguma versão", jamais "esta versão está aprovada".
 */

const HOOKS_JSON = {
  hooks: {
    SessionStart: [{ matcher: "startup|resume", hooks: [{ type: "command", command: 'python3 "C:\\Users\\x\\.codex\\hooks\\session_start.py"' }] }],
    PreToolUse: [{ matcher: "^Bash$", hooks: [{ type: "command", command: 'python3 "C:\\Users\\x\\.codex\\hooks\\pre_tool_use_security.py"' }] }],
    Stop: [{ hooks: [{ type: "command", command: 'python3 "C:\\Users\\x\\.codex\\hooks\\stop.py"' }] }],
  },
}

function fixture({ trusted = [], hooksJson = HOOKS_JSON, configBody = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-codex-trust-"))
  mkdirSync(path.join(dir, ".codex"), { recursive: true })
  const hooksPath = path.join(dir, ".codex", "hooks.json")
  writeFileSync(hooksPath, JSON.stringify(hooksJson, null, 2))
  const lines = ["[hooks]", 'on_stop = ["python stop.py"]', ""]
  for (const [i, slot] of trusted.entries()) {
    lines.push(`[hooks.state.'${hooksPath}:${slot}']`, `trusted_hash = "sha256:${"a".repeat(63)}${i}"`, "")
  }
  const configPath = path.join(dir, ".codex", "config.toml")
  writeFileSync(configPath, configBody === null ? lines.join("\n") : configBody)
  return { dir, configPath, hooksPath }
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })

test("parseTrustStateKey: caminho Windows tem ':' no drive — split pela DIREITA, nunca pela esquerda", async () => {
  const { parseTrustStateKey } = await imp("src/harness/codex-trust.js")
  const k = parseTrustStateKey("C:\\Users\\lucas\\.codex\\hooks.json:pre_tool_use:0:0")
  assert.equal(k.hooksFile, "C:\\Users\\lucas\\.codex\\hooks.json")
  assert.equal(k.event, "pre_tool_use")
  assert.equal(k.groupIndex, 0)
  assert.equal(k.hookIndex, 0)
})

test("parseTrustStateKey: chave sem os 3 campos finais ou com índice não-numérico -> null (nunca inventa slot)", async () => {
  const { parseTrustStateKey } = await imp("src/harness/codex-trust.js")
  assert.equal(parseTrustStateKey("sem-formato"), null)
  assert.equal(parseTrustStateKey("arquivo:evento:x:0"), null)
  assert.equal(parseTrustStateKey("arquivo:evento:0:y"), null)
})

test("enumerateCodexHooks: achata evento/grupo/hook e marca o que é do gstack", async () => {
  const { enumerateCodexHooks } = await imp("src/harness/codex-trust.js")
  const hooks = enumerateCodexHooks(HOOKS_JSON)
  assert.equal(hooks.length, 3)
  assert.ok(hooks.every((h) => h.gstackOwned), "os 3 apontam para scripts nossos")
  assert.deepEqual(hooks.map((h) => h.event), ["SessionStart", "PreToolUse", "Stop"])
})

test("enumerateCodexHooks: JSON sem a chave `hooks` ou malformado -> [] (nunca crasha)", async () => {
  const { enumerateCodexHooks } = await imp("src/harness/codex-trust.js")
  assert.deepEqual(enumerateCodexHooks(null), [])
  assert.deepEqual(enumerateCodexHooks({}), [])
  assert.deepEqual(enumerateCodexHooks({ hooks: { X: "não é array" } }), [])
})

// O caso EXATO do cenário 6 do PRD49.
test("CENÁRIO 6 (PRD49): hook presente SEM aprovação registrada -> awaiting_user_trust", async () => {
  const { codexTrustStatus, codexTrustVerdict, awaitingUserTrust } = await imp("src/harness/codex-trust.js")
  const f = fixture({ trusted: [] })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(st.counts.awaitingUserTrust, 3)
    assert.equal(st.counts.recorded, 0)
    assert.equal(awaitingUserTrust(st).length, 3)
    assert.equal(codexTrustVerdict(st).verdict, "awaiting_user_trust")
  } finally { cleanup(f.dir) }
})

test("aprovação registrada em TODOS os slots -> trusted_environment (com ressalva explícita)", async () => {
  const { codexTrustStatus, codexTrustVerdict } = await imp("src/harness/codex-trust.js")
  const f = fixture({ trusted: ["session_start:0:0", "pre_tool_use:0:0", "stop:0:0"] })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(st.counts.recorded, 3)
    assert.equal(st.counts.awaitingUserTrust, 0)
    const v = codexTrustVerdict(st)
    assert.equal(v.verdict, "trusted_environment")
    assert.match(v.caveat, /NÃO prova que a versão atual/, "o veredito verde carrega o limite junto")
  } finally { cleanup(f.dir) }
})

// Achado real lendo os dois arquivos desta máquina: o Codex grava snake_case na
// chave de estado e PascalCase no hooks.json. Sem normalizar, TUDO daria pendente.
test("evento em snake_case na state key casa com PascalCase do hooks.json", async () => {
  const { codexTrustStatus } = await imp("src/harness/codex-trust.js")
  const f = fixture({ trusted: ["pre_tool_use:0:0"] })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    const pre = st.entries.find((e) => e.event === "PreToolUse")
    assert.equal(pre.trust, "recorded", "pre_tool_use ≡ PreToolUse")
    assert.equal(st.entries.find((e) => e.event === "Stop").trust, "awaiting_user_trust")
  } finally { cleanup(f.dir) }
})

test("aprovação ÓRFÃ (slot que não existe mais) -> trust_stale, não verde", async () => {
  const { codexTrustStatus, codexTrustVerdict } = await imp("src/harness/codex-trust.js")
  const f = fixture({ trusted: ["session_start:0:0", "pre_tool_use:0:0", "stop:0:0", "pre_tool_use:9:9"] })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(st.counts.orphanTrust, 1)
    assert.equal(codexTrustVerdict(st).verdict, "trust_stale")
  } finally { cleanup(f.dir) }
})

test("Codex não configurado (hooks.json ausente) -> codex_not_configured, jamais 'confiável'", async () => {
  const { codexTrustStatus, codexTrustVerdict } = await imp("src/harness/codex-trust.js")
  const dir = mkdtempSync(path.join(tmpdir(), "gstack-codex-trust-"))
  try {
    const st = codexTrustStatus({ configPath: path.join(dir, "nada.toml"), hooksPath: path.join(dir, "nada.json") })
    assert.equal(st.hooksFound, false)
    assert.equal(codexTrustVerdict(st).verdict, "codex_not_configured")
  } finally { cleanup(dir) }
})

test("hooks presentes mas NENHUM do gstack -> gstack_hooks_absent (não é ambiente nosso confiável)", async () => {
  const { codexTrustStatus, codexTrustVerdict } = await imp("src/harness/codex-trust.js")
  const alheio = { hooks: { Stop: [{ hooks: [{ type: "command", command: "outra-ferramenta --run" }] }] } }
  const f = fixture({ hooksJson: alheio, trusted: ["stop:0:0"] })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(st.counts.gstackOwned, 0)
    assert.equal(codexTrustVerdict(st).verdict, "gstack_hooks_absent")
  } finally { cleanup(f.dir) }
})

test("CONTROLE NEGATIVO: config.toml malformado degrada honestamente — tudo vira pendente, nada é 'aprovado'", async () => {
  const { codexTrustStatus, codexTrustVerdict } = await imp("src/harness/codex-trust.js")
  const f = fixture({ configBody: "isso [ não é ] toml = = válido" })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(st.configFound, false, "não conseguimos ler = não fingimos que lemos")
    assert.equal(st.counts.recorded, 0)
    assert.equal(codexTrustVerdict(st).verdict, "awaiting_user_trust")
  } finally { cleanup(f.dir) }
})

test("CONTROLE NEGATIVO: leitura é READ-ONLY — nenhum arquivo é criado ou alterado", async () => {
  const { codexTrustStatus } = await imp("src/harness/codex-trust.js")
  const f = fixture({ trusted: ["stop:0:0"] })
  try {
    const before = { cfg: readFileSync(f.configPath, "utf-8"), hooks: readFileSync(f.hooksPath, "utf-8") }
    codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(readFileSync(f.configPath, "utf-8"), before.cfg)
    assert.equal(readFileSync(f.hooksPath, "utf-8"), before.hooks)
  } finally { cleanup(f.dir) }
})

test("CONTROLE NEGATIVO: o módulo NUNCA recomputa/valida o trusted_hash (limite declarado no payload)", async () => {
  const { codexTrustStatus, CODEX_TRUST_LIMITS } = await imp("src/harness/codex-trust.js")
  const src = readFileSync(path.join(repoRoot, "src", "harness", "codex-trust.js"), "utf-8")
  assert.ok(!/createHash|sha256\(/.test(src), "sem hashing: fingir verificação seria inventar prova")
  assert.equal(CODEX_TRUST_LIMITS.hashRecomputable, false)
  const f = fixture({ trusted: ["stop:0:0"] })
  try {
    const st = codexTrustStatus({ configPath: f.configPath, hooksPath: f.hooksPath })
    assert.equal(st.limits.hashRecomputable, false, "o limite viaja no payload, não só no comentário")
    assert.ok(st.entries.every((e) => e.trust !== "verified"), "nenhum estado promete verificação")
  } finally { cleanup(f.dir) }
})

// Execução REAL na máquina (o "ambiente confiável" que o sprint pede). Só
// afirma o que é verdade em qualquer máquina; onde o Codex não existe (CI),
// degrada pro veredito honesto em vez de fabricar.
test("EXECUÇÃO REAL: lê o ~/.codex desta máquina e emite veredito honesto (degrada se ausente)", async () => {
  const { codexTrustStatus, codexTrustVerdict, codexConfigPath, codexHooksPath } = await imp("src/harness/codex-trust.js")
  const st = codexTrustStatus()
  assert.equal(st.schemaVersion, "gstack.codex-trust.v1")
  assert.equal(st.configPath, codexConfigPath(homedir()))
  const v = codexTrustVerdict(st)
  assert.ok(["trusted_environment", "awaiting_user_trust", "trust_stale", "codex_not_configured", "gstack_hooks_absent"].includes(v.verdict))
  if (!existsSync(codexHooksPath())) assert.equal(v.verdict, "codex_not_configured", "sem Codex instalado, jamais 'confiável'")
  else assert.equal(st.counts.total, st.entries.length)
})

async function captureStdout(fn) {
  let out = ""
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = (s) => { out += s; return true }
  try { await fn() } finally { process.stdout.write = orig }
  return out.trim().split("\n").pop()
}

test("CLI REAL: `agents codex-trust --json` devolve o payload com veredito e limites", async () => {
  const { agentsCommand } = await imp("src/commands/agents.js")
  const f = fixture({ trusted: [] })
  try {
    const out = JSON.parse(await captureStdout(() => agentsCommand(["codex-trust", "--json"], { configPath: f.configPath, hooksPath: f.hooksPath })))
    assert.equal(out.schemaVersion, "gstack.codex-trust.v1")
    assert.equal(out.verdict.verdict, "awaiting_user_trust")
    assert.equal(out.limits.hashRecomputable, false)
  } finally { cleanup(f.dir) }
})
