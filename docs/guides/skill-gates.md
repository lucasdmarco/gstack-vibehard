# Skill-gates: o que são e por que existem

Um **skill-gate** é uma pergunta ou checagem que aparece no fluxo para você **não
perder trabalho**. A regra é sempre a mesma:

> A **skill aconselha**; o **gate decide** se o fluxo avança.
> O verificador é **sempre determinístico** — um modelo de linguagem **nunca** aprova
> um gate. Quem decide é `verify`/`proof` e as checagens de arquivo/comando.

## `blocking` vs `advisory`

- **blocking**: sem satisfazer, a etapa **não passa**. Ex.: escrever UI sem um design
  system definido.
- **advisory**: registra e explica, mas **não trava**. Ex.: recomendar as skills certas
  para a etapa.

## Ver a matriz e entender um gate

```
gstack_vibehard skills gates show
gstack_vibehard skills why design-system-gate
```

O `skills why` explica, para um gate: por que existe, o que ele checa, como
satisfazê-lo, e o **enforcement real por harness**.

## Enforcement honesto por harness

O mesmo gate **não** é imposto igual em todo harness. Veja o real:

```
gstack_vibehard skills harness
```

- `enforced`: existe **implementação + bloqueio real + teste negativo** provando
  que a ação é negada — os três, nunca só a declaração na matriz;
- `advisory`: o gate é registrado, mas não há bloqueio provado naquele harness;
- `unsupported`: o harness não representa aquele gate.

Para o detalhe completo, os **5 estados** de cada gate — `declared` (existe na
matriz) ≠ `routed` (o harness recebe o evento) ≠ `executed` (a checagem roda) ≠
`blocking` (pode negar a ação) ≠ `proved` (teste negativo verificado):

```
gstack_vibehard skills gates doctor
```

Hoje só o Claude intercepta escrita (hook pre-tool); nos demais, um gate de
pre-write é `advisory` (a CLI ainda gateia quando o fluxo passa por ela). E um
gate **só declarado** (sem implementação) é `advisory` em TODO harness — nunca
fingimos que declaração bloqueia.

## Os gates hoje (resumo)

| Gate | Fase | Por quê |
|---|---|---|
| `cwd-health-gate` | intake | não rodar `npm install` na sua pasta pessoal por engano |
| `plan-before-code-gate` | planning | não escrever código sem um plano aprovado |
| `existing-model-intake-gate` | design-ui | perguntar por screenshot/Figma antes de inventar UI |
| `design-system-gate` | design-ui | não escrever UI sem um design system definido |
| `visual-validation-gate` | test-preview | mudança visual precisa de evidência (preview/teste) |
| `secret-deny-gate` | security | nunca versionar/ler `.env` com segredo |
| `db-migration-gate` | data | mudança de schema exige migration |
| `rls-gate` | data | tabela sensível não pode ficar sem RLS/policy |
| `worktree-required-gate` | delegation | delegar sempre em worktree isolada |
| `context-pack-required-gate` | delegation | paralelizar só com Context Pack fresco |
| `verify-proof-gate` | ship | não entregar sem `verify`/`proof` verdes |
| `skill-route-gate` | intake | recomendar as skills certas para a etapa (advisory) |

Para qualquer um deles:

```
gstack_vibehard skills why <gate>
```
