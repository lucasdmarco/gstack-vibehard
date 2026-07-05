# Catálogo — GStack AIDD Methodology Pack

| Skill | id | O que faz | Camada |
|---|---|---|---|
| Guided Delivery | `guided-delivery` | Loop AI-driven ponta-a-ponta: entender contexto → planejar → executar com gates → verificar | plan (knowledge) → execute (execution) → verify (gate determinístico) |

Cada skill tem 3 actions em `skills/<id>/actions/`:

- `01-plan.md` — knowledge/read-only: consulta contexto e produz plano.
- `02-execute.md` — execution/gated: age só em worktree, com provenance.
- `03-verify.md` — gate **determinístico**: `verify`/QG decidem "pronto" (LLM nunca).

Compiladas para `agents/generated/<harness>/` via `gstack_vibehard agents build`.
