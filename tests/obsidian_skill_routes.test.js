import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)
const vendorRoot = path.join(repoRoot, "skills", "vendor", "kepano-obsidian-skills", "a1dc48e68138490d522c04cbf5822214c6eb1202")

/**
 * PRD49 S49.6 — Governed Obsidian skill bundle. Repo real pequeno (5 skills,
 * ~1777 linhas) vendorizado através do pipeline PRD46 real
 * (`src/skills/source-lock.js` buildSourceLock/validateSourceLock — não um
 * manifest inventado). 4 de 5 skills vendorizadas nesta sprint; `defuddle`
 * fica `not_yet_vendored` por um achado real do auditor (instrução de
 * `npm install -g` no upstream, ver upstream-map.md).
 */

test("OBSIDIAN_INTENTS: routing table real, defuddle honestamente not_yet_vendored", async () => {
  const { OBSIDIAN_INTENTS } = await imp("src/skills/obsidian-skill-routes.js")
  const vendored = OBSIDIAN_INTENTS.filter((r) => r.status === "vendored")
  assert.equal(vendored.length, 4)
  const defuddle = OBSIDIAN_INTENTS.find((r) => r.skill === "defuddle")
  assert.equal(defuddle.status, "not_yet_vendored")
  assert.equal(defuddle.entry, null, "nunca aponta pra um arquivo que não existe")
})

test("routeObsidianIntent: cada intent real resolve pra EXATAMENTE 1 skill (nunca mais de 1 no context pack)", async () => {
  const { routeObsidianIntent } = await imp("src/skills/obsidian-skill-routes.js")
  assert.equal(routeObsidianIntent("write_link_note").skill, "obsidian-markdown")
  assert.equal(routeObsidianIntent("create_base").skill, "obsidian-bases")
  assert.equal(routeObsidianIntent("create_canvas").skill, "json-canvas")
  assert.equal(routeObsidianIntent("operate_running_app").skill, "obsidian-cli")
})

test("routeObsidianIntent: intent desconhecido -> null honesto, nunca fabrica rota", async () => {
  const { routeObsidianIntent } = await imp("src/skills/obsidian-skill-routes.js")
  assert.equal(routeObsidianIntent("nao-existe"), null)
})

test("routeObsidianIntent: ingest_webpage aponta defuddle mas status not_yet_vendored -- nunca oferecido como pronto", async () => {
  const { routeObsidianIntent } = await imp("src/skills/obsidian-skill-routes.js")
  const r = routeObsidianIntent("ingest_webpage")
  assert.equal(r.skill, "defuddle")
  assert.equal(r.status, "not_yet_vendored")
})

test("resolveWithinVault: caminho dentro da vault -> true", async () => {
  const { resolveWithinVault } = await imp("src/skills/obsidian-skill-routes.js")
  const vault = path.join(tmpdir(), "gstack-vault-fixture")
  assert.equal(resolveWithinVault(vault, path.join(vault, "notes", "a.md")), true)
})

test("CONTROLE NEGATIVO: path traversal (../) escapa a vault -> false, NUNCA permitido", async () => {
  const { resolveWithinVault } = await imp("src/skills/obsidian-skill-routes.js")
  const vault = path.join(tmpdir(), "gstack-vault-fixture")
  assert.equal(resolveWithinVault(vault, path.join(vault, "..", "outside.md")), false)
  assert.equal(resolveWithinVault(vault, path.join(vault, "notes", "..", "..", "..", "etc", "passwd")), false)
})

test("CONTROLE NEGATIVO: path absoluto fora da vault -> false", async () => {
  const { resolveWithinVault } = await imp("src/skills/obsidian-skill-routes.js")
  const vault = path.join(tmpdir(), "gstack-vault-fixture")
  const outsideAbs = process.platform === "win32" ? "C:\\Windows\\System32\\evil.md" : "/etc/passwd"
  assert.equal(resolveWithinVault(vault, outsideAbs), false)
})

test("isSecretOrEnvPath: .env/.env.local/aninhado detectado; nota normal não", async () => {
  const { isSecretOrEnvPath } = await imp("src/skills/obsidian-skill-routes.js")
  assert.equal(isSecretOrEnvPath(".env"), true)
  assert.equal(isSecretOrEnvPath(".env.local"), true)
  assert.equal(isSecretOrEnvPath("configs/.env"), true)
  assert.equal(isSecretOrEnvPath("notes/my-environment-notes.md"), false)
})

test("canWriteToVault: escrita segura passa; escape de path E secret path são recusados", async () => {
  const { canWriteToVault } = await imp("src/skills/obsidian-skill-routes.js")
  const vault = path.join(tmpdir(), "gstack-vault-fixture")
  const okTarget = path.join(vault, "notes", "a.md")
  assert.deepEqual(canWriteToVault({ vaultRoot: vault, targetPath: okTarget, relPath: "notes/a.md" }), { ok: true })
  const escaped = path.join(vault, "..", "outside.md")
  assert.equal(canWriteToVault({ vaultRoot: vault, targetPath: escaped, relPath: "../outside.md" }).reason, "path_escapes_vault_root")
  assert.equal(canWriteToVault({ vaultRoot: vault, targetPath: okTarget, relPath: ".env" }).reason, "secret_or_env_path_excluded")
})

test("buildObsidianSourceLock: usa o pipeline REAL do PRD46 (source-lock.js), não um manifest inventado", async () => {
  const { buildObsidianSourceLock } = await imp("src/skills/obsidian-skill-routes.js")
  const { validateSourceLock, SOURCE_LOCK_SCHEMA } = await imp("src/skills/source-lock.js")
  const lock = buildObsidianSourceLock({ relEntryPath: "skills/obsidian-markdown/SKILL.md", content: "# fixture", intents: ["write_link_note"] })
  assert.equal(lock.schemaVersion, SOURCE_LOCK_SCHEMA)
  assert.equal(lock.artifactKind, "skill")
  assert.equal(lock.source.commit, "a1dc48e68138490d522c04cbf5822214c6eb1202")
  assert.equal(lock.source.license, "MIT")
  assert.deepEqual(lock.routing.intents, ["write_link_note"])
  const v = validateSourceLock(lock)
  assert.equal(v.ok, true, v.reasons.join(", "))
})

test("PROVENANCE REAL: todo arquivo vendorizado bate com o hash em upstream-map.md (byte fidelity)", async () => {
  const map = readFileSync(path.join(vendorRoot, "upstream-map.md"), "utf-8")
  function walk(d) {
    let out = []
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) out = out.concat(walk(p))
      else if (e.name.endsWith(".md")) out.push(p)
    }
    return out
  }
  const { hashContent } = await imp("src/skills/source-lock.js")
  const files = walk(path.join(vendorRoot, "skills"))
  assert.ok(files.length >= 9, "pelo menos 9 arquivos .md vendorizados")
  for (const f of files) {
    const content = readFileSync(f, "utf-8")
    const hash = hashContent(content).replace("sha256:", "")
    assert.match(map, new RegExp(hash), `${f} deve estar citado em upstream-map.md com seu hash real`)
  }
})

test("LICENSE existe e é MIT real (Steph Ango)", async () => {
  assert.ok(existsSync(path.join(vendorRoot, "LICENSE")))
  const content = readFileSync(path.join(vendorRoot, "LICENSE"), "utf-8")
  assert.match(content, /MIT License/)
  assert.match(content, /Steph Ango/)
})

test("defuddle NÃO foi vendorizado -- nenhum arquivo defuddle existe na árvore vendorizada", async () => {
  function exists(d) {
    if (!existsSync(d)) return false
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.toLowerCase().includes("defuddle")) return true
      if (e.isDirectory() && exists(path.join(d, e.name))) return true
    }
    return false
  }
  assert.equal(exists(path.join(vendorRoot, "skills")), false)
})
