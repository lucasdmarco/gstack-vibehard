import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { mkdtempSync, rmSync } from "node:fs"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

// io fake: mapa path→conteúdo; read() EXPLODE se pedirem algo fora do mapa —
// prova que o scanner só lê o que listou (nunca .env).
const fakeIo = (files) => ({
  listSkillFiles: (root) => Object.keys(files).filter((p) => p.startsWith(root + "/")),
  read: (p) => {
    if (!(p in files)) throw new Error(`LEITURA FORA DO CATÁLOGO: ${p}`)
    return files[p]
  },
})

const SKILL = (name, extra = "") => `---\nname: ${name}\ndescription: faz algo útil\n---\n\n# ${name}\n${extra}\n`

test("catalog: contagem MEDIDA, hash sha256 e provenance por skill (determinístico)", async () => {
  const { buildSkillCatalog, CATALOG_SCHEMA } = await imp("src/skills/catalog.js")
  const io = fakeIo({
    "skills/skills/a/SKILL.md": SKILL("a"),
    "skills/skills/b/SKILL.md": SKILL("b"),
    "agent-packs/p1/skills/g/SKILL.md": SKILL("g"),
    "agents/generated/claude/x/SKILL.md": SKILL("x"),
    "agents/skills/y/SKILL.md": SKILL("y"),
  })
  const c1 = buildSkillCatalog({ io })
  assert.equal(c1.schemaVersion, CATALOG_SCHEMA)
  assert.equal(c1.totalSkills, 5, "conta o que EXISTE, não um número do PRD")
  assert.deepEqual(c1.byPack, { "skills": 2, "agent-packs/p1": 1, "agents-generated/claude": 1, "agents": 1 })
  for (const s of c1.skills) assert.match(s.hash, /^sha256:[0-9a-f]{64}$/)
  const c2 = buildSkillCatalog({ io })
  assert.deepEqual(c2.skills, c1.skills, "mesmo input → mesmo catálogo (ordem por path)")
})

test("catalog: NUNCA lê fora dos SKILL.md listados (a armadilha .env explode)", async () => {
  const { buildSkillCatalog } = await imp("src/skills/catalog.js")
  // .env presente no 'repo' fake, mas fora do listSkillFiles → read() nunca é chamado p/ ele
  const files = { "skills/skills/a/SKILL.md": SKILL("a") }
  const io = fakeIo(files)
  const trap = { ...io, read: (p) => { assert.ok(p.endsWith("SKILL.md"), `tentou ler ${p}`); return io.read(p) } }
  const c = buildSkillCatalog({ io: trap })
  assert.equal(c.totalSkills, 1)
})

test("catalog: skill sem frontmatter NÃO quebra — vira frontmatter:missing", async () => {
  const { buildSkillCatalog } = await imp("src/skills/catalog.js")
  const c = buildSkillCatalog({ io: fakeIo({
    "skills/skills/ok/SKILL.md": SKILL("ok"),
    "skills/skills/semfm/SKILL.md": "# só corpo, sem yaml\ntexto\n",
  }) })
  assert.equal(c.totalSkills, 2)
  assert.equal(c.missingFrontmatter, 1)
  const semfm = c.skills.find((s) => s.id === "semfm")
  assert.equal(semfm.frontmatter, "missing")
  assert.equal(semfm.name, null)
})

test("parseFrontmatter: yaml simples, aspas, CRLF e ausência", async () => {
  const { parseFrontmatter } = await imp("src/skills/catalog.js")
  assert.equal(parseFrontmatter('---\nname: x\ndescription: "com aspas"\n---\ncorpo').description, "com aspas")
  assert.equal(parseFrontmatter("---\r\nname: y\r\n---\r\ncorpo").name, "y", "CRLF suportado")
  assert.equal(parseFrontmatter("# sem frontmatter"), null)
})

test("catalog: fases classificadas por conteúdo e risco por sinal (nunca executa nada)", async () => {
  const { buildSkillCatalog } = await imp("src/skills/catalog.js")
  const c = buildSkillCatalog({ io: fakeIo({
    "skills/skills/front/SKILL.md": SKILL("front", "Detecta design system antes de gerar UI frontend."),
    "skills/skills/db/SKILL.md": SKILL("db", "Cria migration no Supabase com RLS e auth."),
    "skills/skills/perigosa/SKILL.md": SKILL("perigosa", "```bash\nrm -rf build/\n```"),
  }) })
  assert.ok(c.skills.find((s) => s.id === "front").phases.includes("design-ui"))
  assert.ok(c.skills.find((s) => s.id === "db").phases.includes("data-auth-api"))
  const p = c.skills.find((s) => s.id === "perigosa")
  assert.equal(p.risk, "high")
  assert.equal(p.canRunCommands, true)
})

test("doctor: id duplicado no MESMO pack = problem (ok:false); packs diferentes convivem", async () => {
  const { buildSkillCatalog, skillsDoctor } = await imp("src/skills/catalog.js")
  const dup = skillsDoctor(buildSkillCatalog({ io: fakeIo({
    "skills/skills/x/SKILL.md": SKILL("x"),
    "skills/x/SKILL.md": SKILL("x2"), // mesmo pack "skills", mesmo id "x"
  }) }))
  assert.equal(dup.ok, false)
  assert.ok(dup.findings.some((f) => f.id === "duplicate_id_same_pack"))
  const ok = skillsDoctor(buildSkillCatalog({ io: fakeIo({
    "skills/skills/x/SKILL.md": SKILL("x"),
    "agents/skills/x/SKILL.md": SKILL("x"),
  }) }))
  assert.equal(ok.ok, true, "packs diferentes podem repetir id")
})

test("CLI: skills catalog --json é JSON PURO e skills é KNOWLEDGE no firewall", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const { layerOf } = await imp("src/meta/command-layers.js")
  assert.equal(layerOf("skills"), "knowledge", "inventário nunca edita fonte")
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await skillsCommand(["catalog", "--json"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const j = JSON.parse(buf.trim()) // lança se houver banner antes
  assert.equal(j.schemaVersion, "gstack.skill-catalog.v1")
  assert.ok(j.totalSkills >= 200, `repo real tem 200+ skills (mediu ${j.totalSkills})`)
})

test("REGRESSÃO máquina limpa: catalog mede o PACOTE, não o cwd (cwd vazio ≠ 0 skills)", async () => {
  // Bug real achado na máquina limpa C:\Users\Windows: instalado, `skills catalog`
  // media o cwd do usuário (vazio) e dava 0 → gates todos "skill desconhecida".
  const { skillsCommand } = await imp("src/commands/skills.js")
  const neutral = mkdtempSync(path.join(os.tmpdir(), "skills-cwd-"))
  try {
    let out = ""
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out += s; return true }
    try { await skillsCommand(["catalog", "--json"], { cwd: neutral }) } finally { process.stdout.write = orig }
    const cat = JSON.parse(out.trim().split("\n").pop())
    assert.ok(cat.totalSkills >= 200, `cwd neutro deve catalogar o PACOTE (veio ${cat.totalSkills})`)

    // e os gates não podem marcar as skills do pacote como "desconhecidas"
    out = ""
    process.stdout.write = (s) => { out += s; return true }
    try { await skillsCommand(["gates", "show", "--json"], { cwd: neutral }) } finally { process.stdout.write = orig }
    const m = JSON.parse(out.trim().split("\n").pop())
    assert.equal(m.catalogTotalSkills >= 200, true)
    assert.equal(m.warnings.length, 0, "gates não devem ter skill desconhecida quando o catálogo é o do pacote")
  } finally { rmSync(neutral, { recursive: true, force: true }) }
})

test("CLI: skills doctor --strict com warnings → exitCode 1 (repo real tem 10 sem frontmatter)", async () => {
  const { skillsCommand } = await imp("src/commands/skills.js")
  const orig = process.stdout.write.bind(process.stdout)
  let buf = ""
  process.stdout.write = (s) => { buf += String(s); return true }
  try { await skillsCommand(["doctor", "--json", "--strict"], { cwd: repoRoot }) } finally { process.stdout.write = orig }
  const j = JSON.parse(buf.trim())
  assert.equal(typeof j.ok, "boolean")
  if (j.findings.some((f) => f.severity !== "info")) assert.equal(process.exitCode, 1)
  process.exitCode = 0
})
