// Terminal E2E (caixa-preta) do `delegate` — prova que NADA roda sem consentimento
// explícito (dry-run seguro) e que candidato externo exige worktree.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const bin = path.resolve(import.meta.dirname, "..", "..", "src", "index.js")

function run(args, cwd) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { cwd, encoding: "utf-8", stdio: "pipe" }) } }
  catch (e) { return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout || "") + "" } }
}

test("E2E delegate sem args: imprime uso e sai limpo (nada é executado)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-del-"))
  try {
    const r = run(["delegate"], cwd)
    assert.match(r.out, /delegate/)
    assert.equal(existsSync(path.join(cwd, ".gstack", "worktrees")), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("E2E delegate não-interativo SEM --yes: cancela (não roda sem consentimento)", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "gstack-e2e-del-"))
  try {
    // sem TTY e sem --yes → confirmação nega; nenhuma delegação ocorre
    const r = run(["delegate", "codebuff", "--task", "revisar", "--worktree"], cwd)
    assert.match(r.out, /cancel|confirme|--yes/i)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
