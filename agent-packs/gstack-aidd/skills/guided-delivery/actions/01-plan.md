# Action 01 — Plan (knowledge, read-only)

## Inputs

- A tarefa/objetivo em uma frase.
- Acesso à base local indexada (`context`).

## Processo

1. `gstack_vibehard context index --reindex` — garante o grafo fresco.
2. `gstack_vibehard context scout "<tarefa>" --json --mode decision_context` — recupera
   decisões e restrições históricas antes de propor qualquer mudança.
3. Rascunhe o plano com `gstack_vibehard plan` (gera plano, **não** executa).

## Outputs

- Plano com passos, arquivos-alvo e critérios de verificação.
- Lista de invariantes a respeitar (segurança, gates, worktree).

## Checklist

- [ ] O contexto foi indexado e consultado ANTES do plano.
- [ ] Nenhum arquivo-fonte foi editado nesta fase (é read-only).
- [ ] O plano nomeia como será verificado (fase 03).

> Esta action é **knowledge/read-only**: consulta e planeja, nunca edita código.
