# Scroll World: capacidade distribuída, nunca um catálogo novo

`src/capabilities/scroll-world.js` e `src/capabilities/media-budget.js` distribuem as
regras auditadas do Scroll World para papéis de especialista **já existentes**
(`frontend-specialist`, `performance-optimizer`, `qa-automation-engineer`) — `PUBLIC_SKILL_ID`
é sempre `null`. Não existe papel dedicado de UX/acessibilidade hoje; `ux`/`accessibility`
mapeiam para `frontend-specialist` (many-to-one honesto, nunca um papel fabricado).

## Intake obrigatório (8 itens, fail-closed)

`validateScrollWorldIntake(intake)` exige todos os 8 itens do plano — assunto do negócio,
brand kit/proposta, direção de marca, cenas/copy ordenadas, cadeia desktop-only vs mobile
nativo, provider/tier, estimativa de gerações (still/vídeo/reroll/risco), e **confirmação
explícita de gasto** (`spendConfirmed: true` literal — `--yes` nunca basta, mesma
invariante do `costGateStatus` desde o S49.0).

## Orçamento nunca bypassável

- `canProceedWithMediaSpend` reusa `costGateStatus` (S49.0) — não duplica a lógica.
- `enforceIterationCap`: cap fixo, nunca deixa rodar acima do limite.
- `oneProviderPerChain`: 1 provider/modelo por chain, a menos que uma recuperação
  documentada seja aprovada explicitamente.
- `buildMediaManifestEntry`: todo arquivo gerado registra provider, hash do prompt,
  modelo, origem, nota de licença, dimensões e hash do arquivo.

## Fallback nunca destrutivo

`resolveGenerationFallback` — qualquer dependência ausente (auth/créditos/FFmpeg/Pillow/
capacidade do provider) preserva o brief aprovado e cai para `static_fallback`. O projeto
nunca é destruído nem marcado falsamente como completo.

## E2E com provider fake

`tests/e2e/scroll_world_fixture.e2e.test.js` prova a rota inteira (intake → gate de
gasto → cap de iteração → geração → manifesto) usando `runFakeProviderChain` — os
MESMOS gates reais, só o provider é sintético. Nenhum crédito real é gasto, nenhum
provider pago está configurado nesta sessão.

## Limite honesto desta versão

Esta sprint prova o **controle de fluxo** (intake/orçamento/fallback/manifesto) — não os
gates determinísticos/operacionais do plano original, que exigem um pipeline de mídia e
Playwright real:

- continuidade de seam entre frames renderizados adjacentes;
- viewport mobile honrado (sem center-crop silencioso disfarçado de "mobile nativo");
- caminho reduced-motion mostra conteúdo estático;
- orçamento de performance (bytes de mídia, LCP, lazy loading);
- detector nativo de design (Impeccable) + gate visual existente aplicados à mídia gerada;
- worktree obrigatório + Action Kernel real no fluxo de geração (hoje só validado
  estruturalmente pelos testes puros, não ligado a um comando real).

Nada disso foi fabricado com fixtures fake fingindo prova real — fica como backlog
explícito até haver um provider real configurado e decisão do usuário sobre até onde
investir nessa infraestrutura.
