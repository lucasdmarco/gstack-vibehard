import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD45 S45.6 (P1.9) — o Supply Chain Doctor declarava `hashes: ok` SEM verificar hash nenhum
// (string de recomendação hardcoded). Garantia inexistente: uma dependência alterada a montante
// (imagem `latest`, clone sem commit fixo, download sem digest) mudava o produto instalado sem o
// doctor notar. Correção: um ARTIFACT LOCK — cada artefato declara pacote+versão+integridade,
// imagem+digest, repo+commit ou URL+sha256. Sem pin verificável ⇒ `unknown`/`blocked`, NUNCA
// `ok`. Adulterar um byte do pin declarado ⇒ `blocked`.

const mod = path.resolve(import.meta.dirname, "..", "src", "installer", "artifact-lock.js")
const imp = () => import(`${pathToFileURL(mod)}?t=${Date.now()}`)
const DIGEST = "sha256:" + "a".repeat(64)

test("classifyArtifact: imagem com DIGEST válido = verified; latest ou sem digest = blocked", async () => {
  const { classifyArtifact } = await imp()
  assert.equal(classifyArtifact({ id: "casdoor", kind: "image", ref: `casbin/casdoor@${DIGEST}` }).status, "verified")
  // CONTROLE NEGATIVO: cada forma insegura.
  assert.equal(classifyArtifact({ id: "x", kind: "image", ref: "casbin/casdoor:latest" }).status, "blocked", "latest é mutável")
  assert.equal(classifyArtifact({ id: "x", kind: "image", ref: "casbin/casdoor" }).status, "blocked", "sem tag/digest")
  assert.equal(classifyArtifact({ id: "x", kind: "image", ref: `casbin/casdoor@sha256:short` }).status, "blocked", "digest malformado")
})

test("classifyArtifact: repo git exige commit FIXO (40 hex); branch/tag = blocked", async () => {
  const { classifyArtifact } = await imp()
  assert.equal(classifyArtifact({ id: "atomic", kind: "git", ref: "https://x/y.git", commit: "b".repeat(40) }).status, "verified")
  assert.equal(classifyArtifact({ id: "x", kind: "git", ref: "https://x/y.git", commit: "main" }).status, "blocked", "branch não é imutável")
  assert.equal(classifyArtifact({ id: "x", kind: "git", ref: "https://x/y.git" }).status, "blocked", "sem commit")
})

test("classifyArtifact: URL remota exige sha256; sem hash = unknown (não bloqueia, mas nunca ok)", async () => {
  const { classifyArtifact } = await imp()
  assert.equal(classifyArtifact({ id: "s", kind: "url", ref: "https://x/s.sh", sha256: "c".repeat(64) }).status, "verified")
  const semHash = classifyArtifact({ id: "s", kind: "url", ref: "https://x/s.sh" })
  assert.equal(semHash.status, "unknown", "download opt-in sem hash publicado = unknown honesto")
  assert.notEqual(semHash.status, "ok", "CONTROLE NEGATIVO: nunca `ok` sem verificação")
})

test("classifyArtifact: npm exige version + integrity (sha512 do lockfile)", async () => {
  const { classifyArtifact } = await imp()
  assert.equal(classifyArtifact({ id: "p", kind: "npm", name: "@gstack/x", version: "1.2.3", integrity: "sha512-" + "d".repeat(88) }).status, "verified")
  assert.equal(classifyArtifact({ id: "p", kind: "npm", name: "@gstack/x", version: "^1.2.3" }).status, "blocked", "range não é pin + sem integrity")
})

test("verifyArtifactLock: agrega — verified+unknown = unknown; qualquer blocked = blocked", async () => {
  const { verifyArtifactLock } = await imp()
  const allGood = verifyArtifactLock([{ id: "a", kind: "image", ref: `x@${DIGEST}` }])
  assert.equal(allGood.status, "verified")
  const withUnknown = verifyArtifactLock([{ id: "a", kind: "image", ref: `x@${DIGEST}` }, { id: "b", kind: "url", ref: "https://x/s" }])
  assert.equal(withUnknown.status, "unknown", "um unknown rebaixa o todo (nunca ok)")
  const withBlocked = verifyArtifactLock([{ id: "a", kind: "image", ref: `x@${DIGEST}` }, { id: "b", kind: "image", ref: "x:latest" }])
  assert.equal(withBlocked.status, "blocked", "um blocked bloqueia")
  assert.ok(withBlocked.artifacts.find((a) => a.id === "b").reason, "explica por que bloqueou")
})

test("PRODUTO: o lock REAL do GStack tem o Casdoor por digest (não latest)", async () => {
  const { GSTACK_ARTIFACT_LOCK, classifyArtifact } = await imp()
  const casdoor = GSTACK_ARTIFACT_LOCK.find((a) => a.kind === "image" && /casdoor/.test(a.ref))
  assert.ok(casdoor, "o lock declara a imagem do Casdoor")
  assert.equal(classifyArtifact(casdoor).status, "verified", "a imagem do produto está fixada por digest")
  assert.match(casdoor.ref, /@sha256:[0-9a-f]{64}/, "digest real")
})

test("adulteração de um byte do digest declarado ⇒ blocked (não passa como verified)", async () => {
  const { classifyArtifact } = await imp()
  const tampered = `casbin/casdoor@sha256:${"a".repeat(63)}X` // um char inválido
  assert.equal(classifyArtifact({ id: "c", kind: "image", ref: tampered }).status, "blocked")
})
