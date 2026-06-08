# gstack-vibehard 2.0

**O Ecossistema Definitivo de Engenharia CLI para Agentes de IA.**

O `gstack-vibehard` evoluiu. Ele deixou de ser apenas um kit de templates para se tornar uma **Plataforma de Orquestracao Agentic Cross-Harness**. Construido para desenvolvedores que se recusam a sair do terminal, ele integra ferramentas corporativas de IA como Graphify, Fallow, Headroom, AgentMemory e Harness em um unico instalador.

Nenhuma interface grafica. Nenhum gargalo de contexto. Paralelismo absoluto.

## Superpoderes da v2.0

- **Fabrica de Agentes (Omnistack):** escreva a inteligencia do seu projeto uma vez nas pastas `core/` e `knowledge/`. O compilador gera **21 agentes especialistas** adaptados nativamente para Claude Code, Codex, Cursor e OpenCode.
- **Paralelismo Absoluto (Git Worktrees):** trabalhe em multiplas features ao mesmo tempo. O `workspace_manager.py` isola os agentes em Git Worktrees separadas, clonando automaticamente seus segredos via `.worktreeinclude` para evitar colisoes.
- **Quality Gates Deterministicos (Fallow):** os agentes sao barrados por analise estatica deterministica antes do codigo chegar ao commit.
- **Memoria a Custo Zero (Graphify + AgentMemory):** o sistema mapeia o codigo usando AST via tree-sitter. A IA le a topologia do projeto sem consumir API, economizando contexto.
- **Compressao de Transporte (Headroom):** o proxy integrado comprime RAG, logs e buscas web antes de chegar na LLM.
- **Sandboxing e Governanca:** codigo gerado e testado em Docker efemero. A injecao de contexto suporta Permit.io, Composio e LiteLLM.
- **Sinfonia Assincrona:** hooks emitem sinais sonoros quando tarefas falham ou terminam.

## Instalacao Universal

```bash
npm install -g @gstack-vibehard/installer
gstack_vibehard install
```

Uso interativo via `npx`:

```bash
npx @gstack-vibehard/installer
```

## Como Usar o Ecossistema (CLI-First)

### 1. Criar um ambiente paralelo seguro

Nao use a branch principal. Crie uma worktree para o agente trabalhar:

```bash
python scripts/scripts/workspace_manager.py create feature-x --repo .
```

### 2. Pesquisa Profunda (Deep Research)

Deixe o agente parametrizar a investigacao web com Playwright MCP, Context7 e compressao Headroom:

```bash
python scripts/scripts/deep_research.py "Como implementar OAuth2 no Fastify"
```

O comando gera um dossie em `.gstack/research/` e imprime apenas o caminho do arquivo para o agente principal abrir e executar.

### 3. Evocar um Time de Agentes (Harness)

Monte equipes locais no padrao Agent Teams:

```bash
python scripts/scripts/team_builder.py producer-reviewer
```

Padroes suportados:

- `producer-reviewer`
- `pipeline`
- `fan-out`

### 4. Deploy a Jato

Rode o Agente Deployer. Ele aciona Fallow para aprovacao de QA e usa GitHub CLI e Vercel CLI quando autorizado.

## O que instala

| Componente | Descricao |
|------------|-----------|
| Hooks Python | `qg.py`, `gc.py`, `session_start.py`, `stop.py`, `post_sprint.py` |
| Skills | frontend-design, chronicle, project-init e biblioteca completa de skills |
| Template | fullstack-monorepo com variantes backend |
| Agentes | 21 especialistas cross-harness |
| Ferramentas | gbrain, graphify, Playwright, Headroom, Fallow, AgentMemory |
| MCP | servidores base para RAG, browser, memoria, governanca e integracoes |

## Comandos

```bash
gstack_vibehard install        # Instalar no ambiente
gstack_vibehard doctor         # Diagnosticar ambiente
gstack_vibehard init <nome>    # Criar novo projeto com template
gstack_vibehard sprint --save  # Rodar post-sprint
gstack_vibehard help           # Mostrar ajuda
```

## Filosofia

A inteligencia artificial nao deve remover o engenheiro do controle; deve dar a ele um exercito de terminal.

## Licenca

MIT - see [LICENSE](LICENSE).

Third-party attributions in [NOTICE](NOTICE).
