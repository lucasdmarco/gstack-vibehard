# Minimality gate: dependência/abstração nunca sem justificativa

`src/skills/minimality.js` avalia uma decisão de implementação a partir de evidência
explícita — nunca de diff/LOC bruto:

```
necessary, existingReuse, platformOrStdlib, installedDependency,
newDependencyReason, smallestCompleteApproach, protectedConcerns
```

## Regras

- Introduzir uma dependência nova **sem** `newDependencyReason` → `blocked`.
- Introduzir uma abstração nova quando reuse/stdlib **comprovadamente** disponível E a
  abordagem não é a menor completa → `blocked`.
- Qualquer `protectedConcerns` presente (`security`, `validation`, `tests`,
  `accessibility`, `observability`, `explicit_user_scope`) → **sempre** `exempt`, mesmo
  sem motivo registrado. Esses concerns nunca esperam por justificativa.
- Nada introduzido → `pass`.

## Diff/LOC nunca supera correção

`minimalityNeverOutranksCorrectness` é a garantia de que o veredito de correção
(testes/verify) sempre vence: código menor mas quebrado nunca é "resgatado" por ser
minimalista, e um veredito de minimality `blocked` nunca finge que código correto falhou.

## Limite honesto desta versão

O gate (`minimality-gate` em `src/skills/gate-matrix.js`) é **declarado, não
implementado** — de propósito. Não existe hoje nenhum planner/reviewer que popule
`decision`-evidence a partir de uma implementação real (isso exigiria o agente
autorreportar por que introduziu uma dependência, o que não está wireado). Por isso o
gate nunca cita `implementedBy`/`provedBy` na matriz — citar isso faria
`gate-truth.js` computar `enforced:true` FALSAMENTE. `evaluateMinimality` é real e
testado; o wiring real (planner reportando decision-evidence) fica para quando houver um
consumidor de verdade.

`scripts/bench-minimality.mjs` compara famílias de fixture determinísticas — nunca um
benchmark cross-harness ao vivo, nunca uma % de "Ponytail" ou qualquer economia alegada
como resultado do GStack.
