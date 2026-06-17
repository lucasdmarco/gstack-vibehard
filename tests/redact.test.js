import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const mod = path.join(repoRoot, "src", "security", "redact.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)

test("redactSecrets: mascara tokens e expõe só fingerprint (nunca o segredo)", async () => {
  const { redactSecrets } = await imp()
  const r = redactSecrets("usa sk_live_ABCD1234EFGH5678IJKL90 e ghp_" + "B".repeat(36))
  assert.match(r.redacted, /\*\*\*REDACTED\*\*\*/)
  assert.ok(!r.redacted.includes("sk_live_ABCD1234EFGH5678IJKL90"))
  assert.ok(r.count >= 2)
  for (const f of r.fingerprints) assert.match(f, /^sha256:/)
})

test("redactSecrets: texto limpo não muda; hasSecret falso", async () => {
  const { redactSecrets, hasSecret } = await imp()
  const clean = "build passou, 0 erros"
  assert.equal(redactSecrets(clean).redacted, clean)
  assert.equal(redactSecrets(clean).count, 0)
  assert.equal(hasSecret(clean), false)
  assert.equal(hasSecret("password: \"hunter2hunter2\""), true)
})

test("redactSecrets: paridade de padrões com o _output_guard (chaves/PEM)", async () => {
  const { redactSecrets } = await imp()
  assert.ok(redactSecrets("-----BEGIN RSA PRIVATE KEY-----").count >= 1)
  assert.equal(redactSecrets("").count, 0)
})
