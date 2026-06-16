import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

/**
 * A2A Agent Card — interoperabilidade mínima e OFFLINE.
 *
 * Apenas DESCREVE as capacidades reais do gstack num JSON no formato A2A
 * (Agent Card). NÃO inicia servidor, NÃO registra agentes externos. As skills
 * refletem o que existe de verdade: Document Graph, workflow runner, quality
 * gate e delegação opt-in.
 */
function pkgVersion() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")).version
  } catch {
    return "0.0.0"
  }
}

export function buildAgentCard() {
  return {
    name: "gstack-vibehard",
    description: "Control plane cross-harness: Document Graph local, workflow runner determinístico, quality gates e delegação opt-in.",
    version: pkgVersion(),
    protocol: "a2a",
    url: "local://gstack_vibehard", // offline — sem servidor ativo
    provider: { organization: "gstack-vibehard", url: "https://github.com/lucasdmarco/gstack-vibehard" },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text", "application/json"],
    skills: [
      {
        id: "context.search",
        name: "Document Graph search",
        description: "Busca documental local (SQLite/FTS5), offline, sem LLM. Retorna path/heading/trecho/score.",
        tags: ["search", "graphrag", "offline"],
        examples: ["gstack_vibehard context search \"por que usamos Casdoor?\""],
      },
      {
        id: "workflow.run",
        name: "Deterministic workflow runner",
        description: "Orquestra worker→verifier→retry/handoff com caps e journal/replay. Arestas decididas por código.",
        tags: ["workflow", "deterministic", "replay"],
        examples: ["gstack_vibehard workflow run --task \"implementar auth\" --max-iterations 3"],
      },
      {
        id: "quality.gate",
        name: "Quality Gate (Fallow)",
        description: "Verificação determinística (Fallow/CRAP, código morto) e Test Gate, sem consumir tokens de LLM.",
        tags: ["quality", "verify", "deterministic"],
        examples: ["python ~/.gstack/hooks/qg.py --path . --level 1"],
      },
      {
        id: "delegate.opencode",
        name: "OpenCode delegation (opt-in)",
        description: "Delega uma tarefa ao OpenCode (modelo do usuário) numa worktree isolada; retorno estruturado. Opt-in, com confirmação.",
        tags: ["delegation", "opt-in", "isolated"],
        examples: ["gstack_vibehard delegate opencode --task \"corrigir testes\" --worktree --yes"],
      },
    ],
  }
}
