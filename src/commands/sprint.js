import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { homedir } from "os"
import { saveSprintSnapshot } from "../skills/sprint-snapshot.js"
import { success, warn, info, error } from "../cli/index.js"

// F4-B: snapshot legível da sprint (best-effort, independe do hook post_sprint).
function gitChangedFiles(cwd) {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8", timeout: 10000 })
      .split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
  } catch { return [] }
}
function writeSprintSnapshotSafe(cwd) {
  try {
    const graphState = existsSync(join(cwd, "graphify-out", "graph.json")) ? "present" : "absent"
    const snap = saveSprintSnapshot({ cwd, changed: gitChangedFiles(cwd), graphState })
    success(`Sprint snapshot: ${snap.dir} (summary.md + closeout.json)`)
  } catch (e) { warn(`Snapshot da sprint (best-effort) falhou: ${e.message}`) }
}

function hooksDir() {
  const primary = join(homedir(), ".gstack", "hooks")
  if (existsSync(primary)) return primary
  return join(homedir(), ".codex", "hooks")
}

const POST_SPRINT = join(hooksDir(), "post_sprint.py")

function resolvePythonCmd() {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe", timeout: 5000 })
    return "python3"
  } catch {
    return "python"
  }
}

export async function sprintCommand(args) {
  const flag = args[0]

  if (flag === "--save") {
    const cwd = process.cwd()
    const lastMsgFile = join(hooksDir(), "last_message.txt")

    // Snapshot da sprint SEMPRE (F4-B) — antes do hook, que é opcional/legado.
    writeSprintSnapshotSafe(cwd)

    if (!existsSync(POST_SPRINT)) {
      error("post_sprint.py nao encontrado em ~/.gstack/hooks/ ou ~/.codex/hooks/")
      error("Reinstale com: gstack_vibehard install")
      process.exit(1)
    }

    let lastMsg = ""
    if (existsSync(lastMsgFile)) {
      lastMsg = readFileSync(lastMsgFile, "utf-8")
    }

    const input = JSON.stringify({ cwd, last_assistant_message: lastMsg })

    info("Executando post-sprint...")
    info("  Atualizando graphify → .graphify/deps.json")
    info("  Atualizando gbrain → .gbrain/context.json")
    info("  Enriquecendo chronicle...")

    let pyCmd // fora do try: o catch (ENOENT) referencia pyCmd na mensagem de erro
    try {
      pyCmd = resolvePythonCmd()
      const result = execFileSync(pyCmd, [POST_SPRINT], {
        input,
        encoding: "utf-8",
        timeout: 30000,
      })

      const data = JSON.parse(result)
      success("Post-sprint concluido!")

      if (data.graphify) {
        info(`  Graphify: ${data.graphify.nodes} nodes, ${data.graphify.edges} edges`)
      }
      if (data.gbrain) {
        info(`  Gbrain: ${data.gbrain.decisions_added} decisoes adicionadas (${data.gbrain.total_decisions} total)`)
      }
      if (data.mom) {
        info(`  MOM: ${data.mom.status}`)
      }
      if (data.chronicle) {
        info(`  Chronicle: ${data.chronicle.status} — ${data.chronicle.file || ""}`)
      }
    } catch (e) {
      if (e.code === "ENOENT") {
        error(`Post-sprint falhou: comando nao encontrado — verifique se ${pyCmd} esta instalado`)
      } else {
        error(`Post-sprint falhou: ${e.message}`)
      }
      process.exit(1)
    }
  } else {
    info("Uso: gstack_vibehard sprint --save")
    info("  Atualiza graphify, gbrain, MOM e chronicle com o estado atual do projeto")
  }
}
