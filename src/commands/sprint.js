import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { homedir } from "os"
import { success, warn, info, error } from "../cli/index.js"

const HOOKS_DIR = join(homedir(), ".codex", "hooks")
const POST_SPRINT = join(HOOKS_DIR, "post_sprint.py")

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
    const lastMsgFile = join(HOOKS_DIR, "last_message.txt")

    if (!existsSync(POST_SPRINT)) {
      error("post_sprint.py nao encontrado em ~/.codex/hooks/")
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

    try {
      const pyCmd = resolvePythonCmd()
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
