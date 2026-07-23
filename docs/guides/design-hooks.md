# Design hooks: por-projeto, por-harness, nunca global

`visual hooks install` escreve orientação do detector de design (PRD49 S49.2B) em
arquivos **project-local** — nunca em `~/.claude`, `~/.codex`, `~/.cursor` ou qualquer
outro caminho da sua home. Cada harness recebe exatamente o mecanismo que ele **realmente
tem hoje**, sem inflar capacidade:

| Harness | Arquivo (no projeto) | Mecanismo real |
|---|---|---|
| Claude Code | `.claude/settings.json` | Hook `PostToolUse` real — advisory, roda depois da escrita, nunca desfaz nada |
| Codex + OpenCode | `AGENTS.md` | Bloco instrucional (nenhum dos dois tem hook project-local; ambos leem AGENTS.md) |
| GitHub Copilot | `.github/copilot-instructions.md` | Bloco instrucional (Copilot não tem API de hooks) |
| Cursor | `.cursor/rules/gstack-design-detector.mdc` | Regra declarativa (`rules_only` — texto, sem bloqueio) |

Nenhum destes bloqueia a escrita. Isso é deliberado — o detector nativo só tem 1 regra
vendorizada até agora (contraste WCAG, ver `docs/guides/design-detector.md`); bloquear
com base numa única regra seria prematuro.

## Comandos

```
gstack_vibehard visual hooks install [--json]   escreve/atualiza as 4 projeções
gstack_vibehard visual hooks status [--json]    read-only — nunca escreve nada
```

## Garantias

- **Nunca global**: todo caminho é relativo ao diretório do projeto (`cwd`); a
  implementação (`src/harness/design-hooks.js`) nunca importa `homedir()`.
- **Preserva o resto byte-a-byte**: conteúdo do usuário fora dos marcadores gstack em
  `AGENTS.md`/`copilot-instructions.md`, e qualquer hook de outro evento em
  `.claude/settings.json`, ficam intocados.
- **Idempotente**: rodar `install` várias vezes nunca duplica a entrada gstack.
- **Malformado aborta sem mutação**: se `.claude/settings.json` não for JSON válido, nada
  é escrito — sem `--force` implícito.

## Limite honesto desta versão

Isso é a projeção de HOJE, não um motor de hooks genérico. Não há sistema de waiver/
exceção com escopo/motivo/ator/expiração ainda (backlog do PRD49 §49.3), e o `verify`
ainda não roda o detector como gate fail-closed no fechamento de fase — o achado de
contraste continua só advisory no `proof` (S49.2B).
