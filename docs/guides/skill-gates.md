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

- `enforced`: o harness (ou a CLI, no caso de gates de ship) **bloqueia de fato**;
- `advisory`: o gate é registrado, mas o harness não intercepta a escrita em tempo real;
- `unsupported`: o harness não representa aquele gate.

Hoje só o Claude tem hook pre-tool que bloqueia escrita; nos demais, um gate de
pre-write é `advisory` (a CLI ainda gateia quando o fluxo passa por ela). Isso é
declarado — nunca fingimos que um advisory bloqueia.

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
