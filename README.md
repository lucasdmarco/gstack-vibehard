# gstack_vibehard

**Cross-harness installer** for Codex CLI, Claude Code, and OpenCode CLI.

Um instalador que guia voce pela configuracao de hooks Python, skills, template fullstack, design system taste-skill, e 20 agentes especialistas — tudo com Quality Gate obrigatorio.

## Quick Start

```bash
npx @gstack-vibehard/installer
```

## Downloads

Os instaladores estao hospedados no [GitHub Releases](https://github.com/lucasdmarco/gstack-vibehard/releases).

| Platform | Download | Descricao |
|----------|----------|-----------|
| Windows | [gstack_vibehard_setup_v0.4.0.exe](https://github.com/lucasdmarco/gstack-vibehard/releases/download/v0.4.0/gstack_vibehard_setup_v0.4.0.exe) | Instalador Inno Setup (.exe) |
| Windows (script) | [install.bat](https://github.com/lucasdmarco/gstack-vibehard/releases/download/v0.4.0/install.bat) | Script batch portatil |
| macOS / Linux | [install.sh](https://github.com/lucasdmarco/gstack-vibehard/releases/download/v0.4.0/install.sh) | Script shell portatil |
| macOS (Homebrew) | `brew install lucasdmarco/gstack-vibehard/gstack_vibehard` | Formula no Homebrew tap |

## O que instala

| Componente | Descricao |
|------------|-----------|
| **Hooks Python** | qg.py (Quality Gate 3 niveis), gc.py (gstack_vibehard Check), session_start.py (chronicle + identity), stop.py (Security Gate), post_sprint.py |
| **Skills** | frontend-design (taste-skill: 4 engines + 3 dials), chronicle (memoria indexada), project-init (setup de variante) |
| **Template** | fullstack-monorepo com 3 variantes backend (Express + Supabase, Fastify + Neon, Hono + Turso) |
| **Design System** | 4 engines visuais (brutalist/soft/minimalist/stitch) + 3 dials (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY) |
| **Agentes** | 20 especialistas (orchestrator, frontend, backend, security, QA, etc.) com QG Gate obrigatorio antes de cada entrega |
| **Ferramentas** | gbrain (IA semantica), graphify (grafos de dependencia), Playwright (chromium), Headroom (governanca) |
| **MCP** | fallow + supabase + playwright + context7 + gbrain + graphify + headroom (7 servidores) |

## Comandos

```bash
gstack_vibehard install     # Instalar gstack_vibehard no ambiente
gstack_vibehard doctor      # Diagnosticar ambiente
gstack_vibehard init <nome> # Iniciar novo projeto com template
gstack_vibehard sprint --save # Executar post-sprint (graphify + gbrain + chronicle)
gstack_vibehard uninstall   # Remover gstack_vibehard
gstack_vibehard list        # Listar componentes instalados
gstack_vibehard help        # Mostrar ajuda
```

## Instaladores

### Windows
Baixe o [.exe installer](https://github.com/lucasdmarco/gstack-vibehard/releases/download/v0.4.0/gstack_vibehard_setup_v0.4.0.exe) ou use o script portatil:
```batch
curl -LO https://github.com/lucasdmarco/gstack-vibehard/releases/download/v0.4.0/install.bat
install.bat
```

### macOS (Homebrew)
```bash
brew install lucasdmarco/gstack-vibehard/gstack_vibehard
```

### macOS / Linux (script)
```bash
curl -LO https://github.com/lucasdmarco/gstack-vibehard/releases/download/v0.4.0/install.sh
chmod +x install.sh
./install.sh
```

### npm (todas as plataformas)
```bash
npx @gstack-vibehard/installer
```

## Licenca

MIT — see [LICENSE](LICENSE).

Third-party attributions in [NOTICE](NOTICE).
