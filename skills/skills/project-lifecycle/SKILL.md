---
name: project-lifecycle
description: "Workflow obrigatório do início ao fim do projeto. Siga o ciclo Plan → Approve → Code → Test → Review → Ship para toda tarefa."
---

# Project Lifecycle — Workflow Obrigatório

Siga este fluxo em TODA tarefa, do início ao fim.

## Ciclo Completo

### 1. PLANO
Crie um arquivo de plano em `.docs/PLANS/` antes de qualquer código:
```
.docs/PLANS/<task-slug>-<YYYYMMDD>.md
```
Conteúdo mínimo:
- **Objetivo**: O que será feito
- **Arquivos**: Lista de arquivos a modificar/criar
- **Riscos**: O que pode dar errado
- **DoD**: Critérios de "pronto" (Definition of Done)
- **Tempo estimado**: Pequena (<1h), Média, Grande (>4h)

### 2. APROVAÇÃO
Apresente o plano ao usuário.
- Se aprovado → vá para Implementação
- Se rejeitado → ajuste o plano e reapresente

### 3. IMPLEMENTAÇÃO
- Siga o plano à risca
- Commits atômicos: `git add -p` para separar mudanças
- Use `split-to-prs` se a mudança for grande
- Atualize `.docs/CHANGELOG.md` se aplicável

### 4. VERIFICAÇÃO
Sempre rode antes de considerar pronto:
```bash
pnpm lint          # Sem erros de tipo/lint
pnpm typecheck     # TypeScript sem erros
pnpm test          # Testes passando
```
Para mudanças visuais:
- Use `dev-preview` para abrir o navegador
- Use `auto-testing` para testes visuais com Playwright

### 5. QUALITY GATE (OBRIGATÓRIO — 3 NÍVEIS)
Execute em sequência ANTES de marcar como completo:

```bash
# Nível 1 — Estrutural (BLOQUEANTE)
python ~/.codex/hooks/qg.py --path <projeto> --level 1
# ✓ placeholders (< 30 linhas)
# ✓ hook ordering (useState após return)
# ✓ typecheck (pnpm typecheck sem erros)
# ✓ cadeia full-stack (schema→codegen→lib→frontend)

# Nível 2 — Estados (BLOQUEANTE)
python ~/.codex/hooks/qg.py --path <projeto> --level 2
# ✓ loading states (useEffect + loading)
# ✓ empty states (EmptyState em pages com search)
# ✓ error states (ErrorState com retry)
# ✓ module gating (getModuleStatus)

# Nível 3 — Conteúdo (RECOMENDADO)
python ~/.codex/hooks/qg.py --path <projeto> --level 3
# ✓ tabs vazias (TabsTrigger sem conteúdo)
# ✓ dados genéricos ("Colaborador N", "Lorem")
# ✓ admin stubs ("aqui", "placeholder")
# ✓ links quebrados (rotas stale)
```

Regras:
- Nível 1 e 2 são BLOQUEANTES: se blocker > 0, resolva antes de prosseguir
- Nível 3 é RECOMENDADO: resolva ou justifique no commit com `#skip`
- Issues NÃO acionáveis (constraint de template) → documentar no commit
- Se QG rejeitar 3+ vezes → pausar e perguntar ao usuário

### 6. REVIEW
- `/review` nativo do Codex
- Peça revisão humana explícita

### 7. ENTREGA
```bash
git add -A && git commit -m "tipo: descrição concisa"
git push
gh pr create --fill
```
- Só merge com CI verde
- Deploy automático via Vercel
- MOM wrap-up: capturar memórias (se MOM instalado)
- learnings.jsonl: registrar pattern, pitfall, architecture, etc
- chronicle: resumo salvo automaticamente no Stop hook

### 8. LEARNING CLOSEOUT (opcional, nunca bloqueante)

Ao final de Test/Review/Ship, avalie sinais tipados do run (retry resolvido, fail→pass, correção
explícita do usuário, comando não óbvio verificado, dead end com assinatura). Se houver sinal
suficiente, pergunte ao usuário — nunca decida sozinho e nunca bloqueie a entrega por ausência
de aprendizado:

```text
Aprendemos um caminho reutilizável nesta rodada.
Salvar como memória, propor uma skill ou descartar?
```

Só bloqueie a entrega se o usuário tentar promover um candidato inválido (sem evidência, sem
`Verified by`). Para a disciplina completa de captura e promoção, consulte a skill
`skill-creator`.

## Gatilhos por tamanho de tarefa

| Tamanho | Arquivos | Subagentes | Exemplo |
|---------|----------|------------|---------|
| Pequena | 1-3 | Não | Fix bug, add field |
| Média | 4-10 | Opcional | Nova feature pequena |
| Grande | 10+ | Sim (multi-agent) | Refactor, migration |

## Lembretes

- **NUNCA edite `.env`** — só `.env.example`
- **NUNCA commite secrets** — tokens, senhas, chaves
- **DB**: `DATABASE_URL` = produção, `DATABASE_URL_TEST` = testes
- **Cost**: Use `model_reasoning_effort = "low"` para tarefas simples, `"high"` só para lógica complexa
- **Skills disponíveis**: `split-to-prs`, `create-rule`, `create-hook`, `dev-preview`, `auto-testing`, `chronicle`
