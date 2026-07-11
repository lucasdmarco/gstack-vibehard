import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

// PRD36 36.2 — enforcement cross-harness HONESTO:
//  - tool.after NUNCA é enforced (roda depois da ação; não desfaz o que já rodou);
//  - harness instrucional NUNCA é enforced;
//  - a declaração bate com a matrix (conformance ok).

const repoRoot = path.resolve(import.meta.dirname, "..")
const imp = (rel) => import(`${pathToFileURL(path.join(repoRoot, rel))}?t=${Date.now()}`)

test("events: NENHUM harness declara tool.after como enforced (pós-ação não bloqueia)", async () => {
  const { EVENT_DECLARATIONS } = await imp("src/harness/events.js")
  for (const [harness, decl] of Object.entries(EVENT_DECLARATIONS)) {
    assert.notEqual(decl.events["tool.after"], "enforced", `${harness} declara tool.after enforced — desonesto`)
  }
})

test("events: claude tool.before enforced (PreToolUse real) mas tool.after advisory (PostToolUse observa)", async () => {
  const { EVENT_DECLARATIONS } = await imp("src/harness/events.js")
  assert.equal(EVENT_DECLARATIONS.claude.events["tool.before"], "enforced")
  assert.equal(EVENT_DECLARATIONS.claude.events["tool.after"], "advisory")
})

test("conformance: declarações reais passam (ok) e claude ainda tem eventos enforced", async () => {
  const { buildConformanceReport } = await imp("src/harness/conformance.js")
  const rep = buildConformanceReport()
  assert.equal(rep.ok, true, `violações: ${JSON.stringify(rep.harnesses.claude?.violations || [])}`)
  assert.ok(rep.harnesses.claude.enforcedEvents.length > 0)
  assert.ok(!rep.harnesses.claude.enforcedEvents.includes("tool.after"))
})

test("conformance: uma declaração falsa de tool.after=enforced é ACUSADA (forbidden_claim)", async () => {
  const { checkDeclaration } = await imp("src/harness/conformance.js")
  const fake = { events: { "session.start": "enforced", "session.stop": "enforced", "message.output": "advisory", "tool.before": "enforced", "tool.after": "enforced", "mcp.call": "enforced", "file.write": "enforced", "command.exec": "enforced" } }
  const violations = checkDeclaration("claude", fake)
  assert.ok(violations.some((v) => v.event === "tool.after" && v.kind === "forbidden_claim"), "tool.after=enforced deve ser proibido")
})

test("instrucionais permanecem sem NENHUM evento enforced", async () => {
  const { buildConformanceReport } = await imp("src/harness/conformance.js")
  const rep = buildConformanceReport()
  for (const [harness, info] of Object.entries(rep.harnesses)) {
    if (info.enforcement === "instructional") assert.equal(info.enforcedEvents.length, 0, `${harness} instrucional com enforced`)
  }
})
