import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD41 S41.0 / PRD40 P0.2 — release-source-parity: só publica o que pode ser
// auditado a partir da fonte pública. Reproduz o defeito da v4.0.0 (gitHead
// órfão / árvore ahead) e prova que agora BLOQUEIA.

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = () => import(`${pathToFileURL(path.join(repoRoot, "src", "release", "source-parity.js"))}?t=${Date.now()}`)

// git mock configurável via TABELA de rotas (cc baixo): cada cenário controla
// remote, contains, ahead, tag.
function gitExec(cfg = {}) {
  const c = { hasRemote: true, head: "abc1234def", contains: "origin/master", ahead: "0", tagLocal: "abc1234def", tagRemote: "abc1234def\trefs/tags/v4.0.1", ...cfg }
  const routes = [
    [(a) => a[0] === "remote" && a.length === 1, () => (c.hasRemote ? "origin" : "")],
    [(a) => a[0] === "rev-parse" && a[1] === "HEAD", () => c.head],
    [(a) => a[0] === "rev-parse", () => c.tagLocal],                    // rev-parse <tag> = objeto direto
    [(a) => a.join(" ").startsWith("branch -r --contains"), () => c.contains],
    [(a) => a.join(" ").startsWith("rev-list --count"), () => c.ahead],
    [(a) => a[0] === "ls-remote", () => c.tagRemote],
  ]
  return (file, args) => {
    if (file !== "git") throw new Error("only git mocked")
    const hit = routes.find(([match]) => match(args))
    return hit ? hit[1]() : ""
  }
}

test("parity: tudo corresponde → passed", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec() })
  assert.equal(r.status, "passed")
})

test("parity: DEFEITO da v4.0.0 — commit não está em branch remoto → failed (bloqueia)", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec({ contains: "" }) })
  assert.equal(r.status, "failed")
  assert.match(r.detail, /não está em nenhum branch remoto/)
})

test("parity: árvore À FRENTE do remoto → failed (nunca publicar ahead)", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec({ ahead: "72" }) })
  assert.equal(r.status, "failed")
  assert.match(r.detail, /72 commit\(s\) à frente/)
})

test("parity: tag ANOTADA — compara o OBJETO direto (linha sem ^{}), ignora a peeled ^{}", async () => {
  const { checkSourceParity } = await imp()
  // tag anotada: 1ª linha = objeto-tag (o que rev-parse local devolve), 2ª = commit peeled ^{}
  const annotated = "aaaa1111objtag\trefs/tags/v4.0.1\nabc1234def\trefs/tags/v4.0.1^{}"
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec({ tagLocal: "aaaa1111objtag", tagRemote: annotated }) })
  assert.equal(r.status, "passed", "objeto-tag local casa com o objeto-tag remoto (garantia forte)")
})

test("parity: tag local ≠ tag remota → failed", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec({ tagRemote: "999deadbeef\trefs/tags/v4.0.1" }) })
  assert.equal(r.status, "failed")
  assert.match(r.detail, /local .* ≠ remoto/)
})

test("parity: tag inexistente no remoto → failed", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec({ tagRemote: "" }) })
  assert.equal(r.status, "failed")
  assert.match(r.detail, /não existe no remoto/)
})

test("parity: sem remoto configurado → not_applicable (nada a auditar contra)", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec({ hasRemote: false }) })
  assert.equal(r.status, "not_applicable")
})

test("parity: não é repo git → not_applicable", async () => {
  const { checkSourceParity } = await imp()
  const throwExec = () => { throw new Error("not a git repo") }
  const r = checkSourceParity({ version: "4.0.1", exec: throwExec })
  assert.equal(r.status, "not_applicable")
})

test("parity: checkPack — npm pack reproduzível (mesmo shasum) → passed; instável → failed", async () => {
  const { checkSourceParity } = await imp()
  const stable = checkSourceParity({ version: "4.0.1", exec: gitExec(), checkPack: true, npmPack: () => "sha-XYZ" })
  assert.equal(stable.status, "passed")
  let n = 0
  const unstable = checkSourceParity({ version: "4.0.1", exec: gitExec(), checkPack: true, npmPack: () => `sha-${n++}` })
  assert.equal(unstable.status, "failed")
  assert.match(unstable.detail, /shasum instável/)
})

test("parity: checkPack — npm pack falha (null) → failed (não reproduzível)", async () => {
  const { checkSourceParity } = await imp()
  const r = checkSourceParity({ version: "4.0.1", exec: gitExec(), checkPack: true, npmPack: () => null })
  assert.equal(r.status, "failed")
  assert.match(r.detail, /não reproduzível/)
})
