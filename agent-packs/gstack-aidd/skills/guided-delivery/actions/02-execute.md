# Action 02 — Execute (execution, gated)

## Inputs

- O plano aprovado da action 01.
- Uma worktree isolada (nunca o branch principal).

## Processo

1. `gstack_vibehard worktree` — isola o trabalho (provenance + rollback).
2. Implemente os passos do plano dentro da worktree.
3. `gstack_vibehard task` / `gstack_vibehard workflow` para execução assistida com gates.
4. Rode o Quality Gate localmente e corrija CRÍTICO/ALTO antes de seguir.

## Outputs

- Mudanças aplicadas **apenas** na worktree, com histórico rastreável.
- Notas de qualquer desvio do plano.

## Checklist

- [ ] Tudo aconteceu em worktree (nada direto no branch principal).
- [ ] QG CRÍTICO/ALTO = 0 antes de encerrar a fase.
- [ ] Nenhum segredo foi lido/impresso/persistido.

> Esta action é **execution/gated**: só age via worktree, gates, provenance e rollback.
> **Nenhum gate é decidido por LLM** — a verificação determinística vem na action 03.
