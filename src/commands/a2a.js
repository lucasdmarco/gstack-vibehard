import { buildAgentCard } from "../a2a/agent-card.js"
import { info, section } from "../cli/index.js"

export async function a2aCommand(args = []) {
  const sub = args[0]
  switch (sub) {
    case "card": {
      // Imprime o Agent Card JSON. NENHUM servidor é iniciado.
      process.stdout.write(JSON.stringify(buildAgentCard(), null, 2) + "\n")
      return
    }
    default:
      section("a2a — interoperabilidade Agent-to-Agent (offline)")
      info("  gstack_vibehard a2a card     Imprime o Agent Card JSON (capacidades reais)")
      info("  (Nenhum servidor é iniciado; nenhum agente externo é registrado.)")
  }
}
