# Caminhos de instalação — escolha UM

Regra de ouro (aprendida do ECC): **não empilhe instalações**. O `consult` recomenda o caminho e detecta empilhamento (hooks legados + atuais na mesma máquina).

| Caminho | Comando | Escreve global? | Para quem |
|---|---|---|---|
| **Projeto lite** (default) | `create meu-app` | **Não** — só `./meu-app` | começar rápido, validar ideia |
| **Projeto full** | `create meu-app --full` | Não (provisiona local: Casdoor/Atomic/ECC) | produto real com governança |
| **Ativar projeto existente** | `enable` (na pasta) | Não — só `.gstack/` local | trazer gates a um repo em andamento |
| **Install project-only** | `install --project-only` | Mínimo (sem deps/MCP global/vault) | máquina compartilhada/CI |
| **Install completo** | `install` | Sim — preflight + confirmação; MCP global com **opt-out** `--no-global-mcp` | máquina de trabalho principal |

## Matriz full vs lite

- **Lite exclui**: Casdoor, Atomic, ECC global, AgentMemory federation, MCP global, vault Obsidian, downloads remotos.
- **Full inclui tudo**, com opt-outs explícitos: `--no-global-mcp`, `--no-obsidian`, `--skip-deps`, `--allow-remote-downloads` (remoto é sempre opt-IN).

## Antes de escrever qualquer coisa

```bash
gstack_vibehard consult "<objetivo>"     # recomendação read-only + detecção de empilhamento
gstack_vibehard install --audit-only     # preview do file plan, sem escrita
gstack_vibehard doctor --impact          # o que JÁ está ativo globalmente nesta máquina
```

## Instalação empilhada (dois caminhos ao mesmo tempo)

Sintoma: hooks em `~/.gstack` **e** `~/.codex` (legado), ou plugin + install manual no mesmo harness.

```bash
gstack_vibehard install --reinstall                 # reaplica limpo (backup + manifest)
gstack_vibehard uninstall --yes --legacy-name-cleanup  # remoção completa, inclusive legado
```

Próximo: [reset & uninstall](reset-uninstall.md)
