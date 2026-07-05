<!-- gstack-comparison-doc: v1 -->
# Comparacao GStack x <repo/produto externo>

> **Gate.** Todo documento de comparacao com repos/produtos externos DEVE partir deste
> template e citar `.docs/RESEARCH/repository-registry.json`. Se o tema envolver
> metodologia, skills, onboarding, marketplace, cross-harness ou AI-driven dev, o
> **batch-6-aidd-methodology** e obrigatorio na comparacao. Uma referencia metodologica
> **nunca** vira dependencia runtime do GStack.

## 1. Contexto

- **O que estamos comparando e por que:**
- **Data / versao do GStack:**
- **Registry consultado:** `.docs/RESEARCH/repository-registry.json` (schemaVersion 1)

## 2. Batches obrigatorios do registry

Liste os repos do registry relevantes ao tema. Para temas de metodologia/onboarding/
skills/marketplace/cross-harness, inclua o batch AIDD completo:

| Repo | status | role | por que entra nesta comparacao |
|---|---|---|---|
| lgsreal/ai-driven-dev | active_reference | learning_track | |
| ai-driven-dev/framework | active_reference | plugin_marketplace_and_sdlc | |
| ai-driven-dev/manifest | active_reference | product_manifesto | |
| ai-driven-dev/prompts | archived_reference | prompt_template_history | referencia historica |
| ai-driven-dev/rules | archived_reference | short_rules_history | referencia historica |
| ai-driven-dev/ai-driven-dev-community | archived_reference | community_catalog_history | referencia historica |

> Repos marcados `archived_reference` entram apenas como **contexto historico**, nunca
> como fonte atual de decisao.

## 3. Adotar / adaptar / rejeitar

| Ideia observada | origem | decisao (adotar/adaptar/evitar/rejeitar) | justificativa |
|---|---|---|---|
| | | | |

## 4. Invariantes respeitadas

- [ ] Nenhuma referencia externa virou dependencia runtime do GStack.
- [ ] Nenhuma config global foi alterada.
- [ ] Metodologia permanece como documentacao/trilha, nao como codigo obrigatorio.
- [ ] Repos `archived_reference` tratados como historico.

## 5. Conclusao

- **O que o GStack absorve (como docs/skill/trilha):**
- **O que fica fora de escopo:**
