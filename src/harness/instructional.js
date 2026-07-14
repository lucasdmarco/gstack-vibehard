import { dirname } from "path"
import { writeWithBackup, ensureDir } from "../installer/merge.js"

/**
 * Harnesses sem API de hooks (Gemini, Windsurf, Kiro, Copilot CLI, Droid,
 * KiloCLI, Kimi) nao podem ser bloqueados programaticamente. A integracao
 * honesta e escrever um arquivo de orientacao no convention global do harness
 * (AGENTS.md / GEMINI.md / global_rules.md / steering) instruindo o agente a:
 *   - rodar o Quality Gate (Fallow) antes de entregar
 *   - usar a memoria persistente (chronicle/AgentMemory)
 *   - economizar tokens via Graphify/Headroom
 */

const MARKER = "<!-- gstack_vibehard:instrucional -->"

export const INSTRUCTIONAL_GUIDANCE = `${MARKER}
# gstack_vibehard — Integracao Instrucional

Este harness nao expoe API de hooks, entao os gates rodam em modo best-effort.
Voce (agente) DEVE seguir este protocolo antes de finalizar qualquer entrega.

## Quality Gate (obrigatorio antes de entregar)
Rode o gate deterministico (Fallow, em Rust — nao consome tokens de LLM):
  npx fallow audit --format json
ou, se o gstack estiver instalado:
  python ~/.gstack/hooks/qg.py --path . --level 1
- Se houver bloqueio CRITICO/ALTO: pare, corrija e re-execute. So entao entregue.
- Se MEDIO/BAIXO: documente e entregue com notas.

## Test Gate (paridade Replit)
Antes de finalizar, rode a suite de testes do projeto (npm test / pytest /
cargo test / go test). Nao entregue codigo com testes vermelhos.

## Memoria persistente (custo zero)
- Decisoes e contexto de sessao vivem no chronicle (~/.gstack/chronicle/).
- Antes de reexplorar o codigo, consulte a topologia via Graphify
  (graphify-out/graph.json) em vez de reler arquivos — economia de tokens.

## Economia de tokens
- Graphify: le a AST/topologia do projeto sem custo de API.
- Headroom: comprime RAG/logs no proxy MCP (economia MEDIDA por ledger; sem numero
  cravado sem benchmark reproduzido nesta maquina).
- Prefira ler o grafo a reler arquivos inteiros.

## Seguranca
- Nunca rode comandos destrutivos (rm -rf /, chmod 777 /, pipe curl|sh).
- Secrets sempre em .env (no .gitignore), nunca hardcoded.
${MARKER}
`

/**
 * Escreve (ou atualiza) o arquivo de orientacao do harness instrucional.
 * Idempotente: substitui o bloco entre marcadores preservando conteudo do
 * usuario fora dele.
 */
export function writeInstructionalGuidance(instructionFile, report, readFile) {
  if (!instructionFile) return false

  let existing = ""
  if (readFile) {
    try { existing = readFile(instructionFile) || "" } catch { existing = "" }
  }

  let content
  if (existing.includes(MARKER)) {
    // Substitui o bloco gstack existente (entre o primeiro e o ultimo MARKER)
    const first = existing.indexOf(MARKER)
    const last = existing.lastIndexOf(MARKER) + MARKER.length
    content = existing.slice(0, first) + INSTRUCTIONAL_GUIDANCE.trim() + existing.slice(last)
  } else if (existing.trim()) {
    // Anexa preservando o conteudo do usuario
    content = existing.trimEnd() + "\n\n" + INSTRUCTIONAL_GUIDANCE
  } else {
    content = INSTRUCTIONAL_GUIDANCE
  }

  ensureDir(dirname(instructionFile))
  writeWithBackup(instructionFile, content)
  if (report) report.updated.push(`instrucional: ${instructionFile}`)
  return true
}
