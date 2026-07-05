# ADR — Barreira Knowledge vs Execution

- **Status:** Accepted
- **Data:** 2026-07-05
- **Contexto PRD:** PRD22 §4.3 (consolidado no PRD23 Fase3), camada AIDD Sprint B.

## Contexto

A metodologia AIDD/lgsreal separa comandos que **consultam/analisam** de comandos que
**agem/mutam**. O GStack já aplica isso na prática (worktree, gates, provenance,
rollback só no caminho de execução), mas a separação não estava declarada de forma
máquina-legível — dificultando auditoria e podendo, no futuro, deixar um comando de
"conhecimento" ganhar poder de escrita sem revisão.

## Decisão

Formalizar a barreira como uma **classificação** (não um gate em runtime) em
`src/meta/command-layers.js`:

- **KNOWLEDGE** (read-only): `context`, `consult`, `challenge`, `plan` e comandos de
  diagnóstico/leitura (`audit`, `qa`, `doctor`, `status`, `list`, `monitor`, `logs`,
  `state`). **Nunca editam código-fonte, nunca passam por worktree/gate.**
- **EXECUTION** (gated): `task`, `workflow`, `delegate`, `dev`, `verify`,
  `publish-guard` e todo comando que muta repo/config/estado. **Só age via worktree,
  gates, provenance e rollback.**
- **NEUTRAL**: meta/ajuda (`help`) — não consulta a base nem muta nada.

Os três conjuntos são **disjuntos**. `layerOf(cmd)` é a fonte única para responder "esse
comando é read-only?". Um teste (`tests/knowledge_execution_firewall.test.js`) garante
que **todo** comando real do `DISPATCH` (`src/cli/index.js`) está classificado e que os
comandos explícitos do PRD22 §4.3 caem na camada certa.

## Invariantes

- Knowledge **nunca** edita código-fonte.
- Execution **só** passa por worktree, gates, provenance e rollback.
- Adicionar um comando novo ao `DISPATCH` sem classificá-lo **quebra o teste** — a
  classificação é obrigatória por construção.
- Esta é uma barreira de **produto/revisão**, não um LLM como gate final.

## Consequências

- Docs, testes e revisão têm uma fonte única para afirmar read-only vs gated.
- Baixo custo: nenhuma mudança de comportamento em runtime; só classificação + teste.
- Trade-off: exige manter `command-layers.js` em dia com o `DISPATCH` (garantido por teste).
