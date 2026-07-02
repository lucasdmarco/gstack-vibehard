import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// provider FAKE em memória (não toca keychain real)
function fakeProvider() {
  const store = new Map()
  return {
    id: "fake", _store: store,
    isAvailable: () => true,
    set: (ns, n, v) => store.set(`${ns}:${n}`, v),
    get: (ns, n) => (store.has(`${ns}:${n}`) ? store.get(`${ns}:${n}`) : null),
    delete: (ns, n) => store.delete(`${ns}:${n}`),
  }
}

// ── schema v1 → v2 ──
test("migrateSecretsSchema: lista de nomes (v1) → estruturado (v2); idempotente", async () => {
  const { migrateSecretsSchema, requiredSecretsForService, allRequiredNames } = await imp("src/secrets/schema.js")
  const v2 = migrateSecretsSchema({ required: ["DATABASE_URL"], optional: ["GH_TOKEN"] })
  assert.equal(v2.schemaVersion, 2)
  assert.equal(v2.provider, "os-keychain")
  assert.deepEqual(v2.required[0], { name: "DATABASE_URL", scope: "runtime", services: [], sensitive: true })
  assert.deepEqual(v2.optional, ["GH_TOKEN"])
  assert.deepEqual(migrateSecretsSchema(v2), v2, "idempotente em v2")

  const scoped = { schemaVersion: 2, provider: "os-keychain", required: [
    { name: "DB", scope: "runtime", services: ["api"] }, { name: "GLOBAL", scope: "runtime", services: [] },
  ] }
  assert.deepEqual(requiredSecretsForService(scoped, "api").sort(), ["DB", "GLOBAL"])
  assert.deepEqual(requiredSecretsForService(scoped, "web"), ["GLOBAL"], "DB é só do api")
  assert.deepEqual(allRequiredNames(scoped).sort(), ["DB", "GLOBAL"])
})

// ── parseDotEnv ──
test("parseDotEnv: KEY=VALUE, aspas, export, ignora comentário/lixo", async () => {
  const { parseDotEnv } = await imp("src/secrets/broker.js")
  const p = parseDotEnv(`# comentário\nexport A=1\nB="dois"\nC='três'\nLIXO sem igual\n=semNome\nD=quatro=cinco`)
  assert.equal(p.A, "1")
  assert.equal(p.B, "dois")
  assert.equal(p.C, "três")
  assert.equal(p.D, "quatro=cinco")
  assert.equal(p.LIXO, undefined)
})

// ── broker com provider fake: índice sem valor, resolve só pedidos ──
test("broker: set/list/get/delete; índice NUNCA guarda valor", async () => {
  const { setSecret, getSecret, listSecretNames, deleteSecret, resolveSecrets } = await imp("src/secrets/broker.js")
  const vaultDir = await mkdtemp(path.join(tmpdir(), "gstack-vault-"))
  const provider = fakeProvider()
  const cwd = "/proj/x"
  const opts = { provider, vaultDir }
  try {
    setSecret(cwd, "DATABASE_URL", "postgres://secret", opts)
    setSecret(cwd, "GH_TOKEN", "ghp_xyz", opts)

    const names = listSecretNames(cwd, opts)
    assert.equal(names.length, 2)
    assert.ok(names.find((n) => n.name === "DATABASE_URL"))
    // ABUSO: o índice no disco NÃO contém o valor (só nomes/metadados)
    const { projectNamespace } = await imp("src/secrets/broker.js")
    const idxFile = path.join(vaultDir, projectNamespace(cwd), "names.json")
    const onDisk = await readFile(idxFile, "utf-8")
    assert.ok(!onDisk.includes("postgres://secret"), "valor NUNCA vai pro índice em disco")
    assert.ok(!onDisk.includes("ghp_xyz"), "token NUNCA vai pro índice")
    assert.ok(onDisk.includes("DATABASE_URL"), "só o nome")

    assert.equal(getSecret(cwd, "DATABASE_URL", opts), "postgres://secret")

    // ABUSO: resolve devolve SÓ os nomes pedidos (não tudo que está guardado)
    const resolved = resolveSecrets(cwd, ["DATABASE_URL"], opts)
    assert.deepEqual(Object.keys(resolved), ["DATABASE_URL"], "GH_TOKEN não pedido → não resolve")

    deleteSecret(cwd, "DATABASE_URL", opts)
    assert.equal(getSecret(cwd, "DATABASE_URL", opts), null)
    assert.equal(listSecretNames(cwd, opts).length, 1)
  } finally { await rm(vaultDir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── SEC-02: nome de segredo com traversal é rejeitado (não vira path no DPAPI) ──
test("broker: nome de segredo inválido é rejeitado (anti path traversal)", async () => {
  const { setSecret, getSecret, deleteSecret, resolveSecrets, assertValidSecretName } = await imp("src/secrets/broker.js")
  const provider = fakeProvider()
  const opts = { provider, vaultDir: await mkdtemp(path.join(tmpdir(), "gstack-vault-")) }
  const cwd = "/proj/x"
  try {
    for (const bad of ["../../evil", "..\\..\\evil", "a/b", "a.dpapi", "1leading", "with space", ""]) {
      assert.throws(() => setSecret(cwd, bad, "v", opts), /nome de segredo inválido/, `set rejeita ${JSON.stringify(bad)}`)
      assert.throws(() => getSecret(cwd, bad, opts), /nome de segredo inválido/)
      assert.throws(() => deleteSecret(cwd, bad, opts), /nome de segredo inválido/)
    }
    // válidos passam
    assert.equal(assertValidSecretName("DATABASE_URL"), "DATABASE_URL")
    setSecret(cwd, "GH_TOKEN", "ghp_ok", opts)
    assert.equal(getSecret(cwd, "GH_TOKEN", opts), "ghp_ok")
    // resolveSecrets: nome hostil vindo de schema é ignorado (não traversa), não lança
    assert.deepEqual(resolveSecrets(cwd, ["../evil", "GH_TOKEN"], opts), { GH_TOKEN: "ghp_ok" })
  } finally { await rm(opts.vaultDir, { recursive: true, force: true, maxRetries: 5 }) }
})

// ── redação ──
test("redact: troca valores de segredo por *** (defesa p/ logs)", async () => {
  const { redact } = await imp("src/secrets/broker.js")
  assert.equal(redact("conn=postgres://secret aqui", ["postgres://secret"]), "conn=*** aqui")
  assert.equal(redact("nada", ["x"]), "nada", "valor curto (<4) não redige")
})

// ── secrets run: aceita comando COM e SEM `--` (shim do Windows engole o `--`) ──
test("parseRunArgs: com `--` e SEM `--` (Windows .cmd) pegam o comando verbatim", async () => {
  const { parseRunArgs } = await imp("src/commands/secrets.js")
  assert.deepEqual(parseRunArgs(["run", "--", "node", "-e", "x"]), ["node", "-e", "x"], "com --")
  assert.deepEqual(parseRunArgs(["run", "node", "-e", "x"]), ["node", "-e", "x"], "sem -- (shim engoliu)")
  assert.deepEqual(parseRunArgs(["run"]), [], "sem comando → vazio")
  assert.deepEqual(parseRunArgs(["run", "--", "pnpm", "--filter", "api", "dev"]), ["pnpm", "--filter", "api", "dev"], "flags do comando preservadas")
})

// ── brokerStatus sem provider ──
test("brokerStatus: sem keychain → available false (honesto)", async () => {
  const { brokerStatus } = await imp("src/secrets/broker.js")
  const s = brokerStatus({ provider: null, force: "inexistente" })
  assert.equal(s.available, false)
  assert.equal(s.provider, null)
})
