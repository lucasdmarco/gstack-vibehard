import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "fs"
import { join } from "path"
import { loadEffectivePolicy } from "../policy/layers.js"
import { compilePolicy } from "../policy/compiler.js"

/**
 * Adapter Devin project-scoped (PRD15 §10.3/§10.4). Gera `.devin/` a partir da
 * Policy DSL do GStack — a MESMA policy que os outros harnesses recebem. Nunca
 * toca `.devin/config.local.json` (segredos/exceções do usuário) e faz backup
 * `.gstack_vibehard.bak` de qualquer arquivo pré-existente antes de reescrever.
 *
 * Honestidade: os hooks chamam comandos REAIS do gstack (`challenge classify`,
 * `audit status`). Sem uma ponte de stdin do Devin, o pre-tool é ADVISORY — o
 * enforcement real só existe quando o Devin carrega e executa os hooks; o doctor
 * faz o downgrade honesto (real_hooks → rules_only) se não validar.
 */

export function devinDir(cwd) { return join(cwd, ".devin") }

/** config.json = permissões compiladas da policy (Devin-like) + hooks vazio (ficam no v1). */
export function buildDevinConfig(policy) {
  const compiled = compilePolicy(policy, "devin")
  return { permissions: compiled.artifact.permissions, hooks: {} }
}

/** hooks.v1.json: pre-tool challenge (advisory) + post-tool audit — comandos reais. */
export function buildDevinHooks() {
  return {
    PreToolUse: [
      { matcher: "exec", hooks: [{ type: "command", command: "gstack_vibehard challenge classify --intent run_command --target devin-exec --json", timeout: 10 }] },
    ],
    PostToolUse: [
      { matcher: "", hooks: [{ type: "command", command: "gstack_vibehard audit status --json", timeout: 10 }] },
    ],
  }
}

const SKILLS = Object.freeze({
  "gstack-context": {
    title: "GStack Context",
    body: "Antes de editar, peça contexto MÍNIMO ao GStack em vez de despejar arquivos:\n`gstack_vibehard context scout \"<pergunta>\"` (read-only). Retorna caminhos e linhas, não dumps.",
    userTriggered: false,
  },
  "gstack-verify": {
    title: "GStack Verify (gate final)",
    body: "NUNCA declare a tarefa pronta sem o gate determinístico do GStack:\n`gstack_vibehard verify --profile full`. Ele é a autoridade final — não a sua auto-revisão.",
    userTriggered: false,
  },
  "gstack-review": {
    title: "GStack Review (advisory)",
    body: "Revisão é ADVISORY, não gate. Para mudanças de ALTO RISCO (config global, push --force,\ndrop database), exija justificativa: `gstack_vibehard challenge evaluate --intent ... --target ...`.",
    userTriggered: true, // alto risco → só sob pedido do usuário
  },
})

function skillMarkdown(id, s) {
  const fm = ["---", `name: ${id}`, `description: ${s.title} (gerado pelo GStack)`]
  if (s.userTriggered) fm.push("triggers: [user]") // alto risco não auto-dispara
  fm.push("---", "")
  return fm.join("\n") + `# ${s.title}\n\n${s.body}\n`
}

/** Grava com backup do pré-existente; NUNCA sobrescreve config.local.json. */
function writeSafe(path, content, written) {
  if (existsSync(path)) copyFileSync(path, path + ".gstack_vibehard.bak")
  writeFileSync(path, content)
  written.push(path)
}

/**
 * Gera os artefatos `.devin/`. @returns {{ written, skipped, policyLayers }}.
 */
export function generateDevinAssets(cwd = process.cwd(), opts = {}) {
  const { policy, layers } = loadEffectivePolicy(opts.cwd || cwd)
  const base = devinDir(opts.cwd || cwd)
  mkdirSync(base, { recursive: true })
  const written = [], skipped = []

  writeSafe(join(base, "config.json"), JSON.stringify(buildDevinConfig(policy), null, 2) + "\n", written)
  writeSafe(join(base, "hooks.v1.json"), JSON.stringify(buildDevinHooks(), null, 2) + "\n", written)

  const localCfg = join(base, "config.local.json")
  if (existsSync(localCfg)) skipped.push(localCfg) // segredos/exceções do usuário — intocável

  for (const [id, s] of Object.entries(SKILLS)) {
    const dir = join(base, "skills", id)
    mkdirSync(dir, { recursive: true })
    writeSafe(join(dir, "SKILL.md"), skillMarkdown(id, s), written)
  }
  return { written, skipped, policyLayers: layers }
}
