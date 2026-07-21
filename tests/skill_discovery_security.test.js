import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// path.join (não concatenação manual) — discovery.js usa join() internamente, que produz
// separador nativo (\\ no Windows); as chaves do io fake precisam bater exatamente com isso.
const ROOT = path.join("C:", "fakeroot")
const j = (...parts) => path.join(ROOT, ...parts)

// io fake: mapa dir -> entradas; sem realpath custom, realpath(p) = p (contido por padrão).
function fakeIo({ dirs, files, realpaths = {} }) {
  return {
    listDir: (dir) => dirs[dir] || [],
    read: (p) => (p in files ? files[p] : null),
    realpath: (p) => (p in realpaths ? realpaths[p] : p),
  }
}

const SKILL_FRONTMATTER = (name) => `---\nname: ${name}\ndescription: faz algo\n---\n\n# ${name}\n`

test("discoverArtifacts: SKILL.md válido vira artifactKind 'skill', read-only (nunca copia/executa)", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("skill-a")
  const io = fakeIo({
    dirs: { [ROOT]: [{ name: "skill-a", isDirectory: true }], [dirA]: [{ name: "SKILL.md", isDirectory: false }] },
    files: { [j("skill-a", "SKILL.md")]: SKILL_FRONTMATTER("skill-a") },
  })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, true)
  assert.equal(r.found.length, 1)
  assert.equal(r.found[0].name, "skill-a")
  assert.equal(r.found[0].artifactKind, "skill")
})

test("discoverArtifacts: plugin.json vira 'rule_pack', marketplace.json vira 'reference_pack'", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("plug-a")
  const dirB = j("mk-b")
  const io = fakeIo({
    dirs: {
      [ROOT]: [{ name: "plug-a", isDirectory: true }, { name: "mk-b", isDirectory: true }],
      [dirA]: [{ name: "plugin.json", isDirectory: false }],
      [dirB]: [{ name: "marketplace.json", isDirectory: false }],
    },
    files: {
      [j("plug-a", "plugin.json")]: JSON.stringify({ name: "plug-a" }),
      [j("mk-b", "marketplace.json")]: JSON.stringify({ name: "mk-b" }),
    },
  })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, true)
  assert.equal(r.found.find((f) => f.name === "plug-a").artifactKind, "rule_pack")
  assert.equal(r.found.find((f) => f.name === "mk-b").artifactKind, "reference_pack")
})

test("discoverArtifacts: path traversal / nome malformado no frontmatter -> bloqueado", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("evil")
  const io = fakeIo({
    dirs: { [ROOT]: [{ name: "evil", isDirectory: true }], [dirA]: [{ name: "SKILL.md", isDirectory: false }] },
    files: { [j("evil", "SKILL.md")]: SKILL_FRONTMATTER("../../etc/passwd") },
  })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, false)
  assert.equal(r.found.length, 0)
  assert.ok(r.problems.some((p) => /malformado/i.test(p.reason)))
})

test("discoverArtifacts: nome com maiúscula/espaço/underscore (fora da convenção) -> bloqueado", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("weird")
  const io = fakeIo({
    dirs: { [ROOT]: [{ name: "weird", isDirectory: true }], [dirA]: [{ name: "SKILL.md", isDirectory: false }] },
    files: { [j("weird", "SKILL.md")]: SKILL_FRONTMATTER("Evil_Name With Space") },
  })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, false)
  assert.equal(r.found.length, 0)
})

test("discoverArtifacts: symlink escape do root -> bloqueado, nunca seguido", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("linked")
  const io = fakeIo({
    dirs: { [ROOT]: [{ name: "linked", isDirectory: true }], [dirA]: [{ name: "SKILL.md", isDirectory: false }] },
    files: { [j("linked", "SKILL.md")]: SKILL_FRONTMATTER("linked") },
    realpaths: { [dirA]: path.join("C:", "outside-root", "linked") }, // symlink que escapa do root
  })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, false)
  assert.equal(r.found.length, 0)
  assert.ok(r.problems.some((p) => /symlink/i.test(p.reason)))
})

test("discoverArtifacts: shadowing ambíguo — dois artefatos com o MESMO nome -> segundo bloqueado", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("a")
  const dirB = j("b")
  const io = fakeIo({
    dirs: {
      [ROOT]: [{ name: "a", isDirectory: true }, { name: "b", isDirectory: true }],
      [dirA]: [{ name: "SKILL.md", isDirectory: false }],
      [dirB]: [{ name: "SKILL.md", isDirectory: false }],
    },
    files: {
      [j("a", "SKILL.md")]: SKILL_FRONTMATTER("dup-name"),
      [j("b", "SKILL.md")]: SKILL_FRONTMATTER("dup-name"),
    },
  })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, false)
  assert.equal(r.found.length, 1, "só o primeiro é aceito")
  assert.ok(r.problems.some((p) => /shadowing/i.test(p.reason)))
})

test("discoverArtifacts: profundidade além do limite -> bloqueado (bounded traversal)", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  // cria uma cadeia de diretórios mais funda que o limite (io simples: cada nível tem 1 subdir)
  const dirs = { [ROOT]: [{ name: "d0", isDirectory: true }] }
  let cur = j("d0")
  for (let i = 1; i <= 10; i++) {
    dirs[cur] = [{ name: `d${i}`, isDirectory: true }]
    cur = path.join(cur, `d${i}`)
  }
  dirs[cur] = []
  const io = fakeIo({ dirs, files: {} })
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => /profundidade/i.test(p.reason)))
})

test("discoverArtifacts: NUNCA lê nada fora de SKILL.md/plugin.json/marketplace.json (a armadilha .env explode)", async () => {
  const { discoverArtifacts } = await imp("src/skills/discovery.js")
  const dirA = j("a")
  const io = {
    listDir: (dir) => ({ [ROOT]: [{ name: "a", isDirectory: true }], [dirA]: [{ name: ".env", isDirectory: false }, { name: "SKILL.md", isDirectory: false }] }[dir] || []),
    read: (p) => { if (p.endsWith(".env")) throw new Error(`LEITURA FORA DO CATÁLOGO: ${p}`); return p.endsWith("SKILL.md") ? SKILL_FRONTMATTER("a") : null },
    realpath: (p) => p,
  }
  const r = discoverArtifacts({ root: ROOT, io })
  assert.equal(r.ok, true)
  assert.equal(r.found.length, 1)
})
