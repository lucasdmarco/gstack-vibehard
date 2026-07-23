# Upstream provenance map — kepano/obsidian-skills

Fonte: https://github.com/kepano/obsidian-skills
Commit auditado: `a1dc48e68138490d522c04cbf5822214c6eb1202` (2026-06-08)
Licença: MIT (ver `./LICENSE`, cópia verbatim)

Repo real pequeno: 5 skills declarativas, ~1777 linhas totais (medido nesta sessão via
mirror read-only real) — diferente em escala do Impeccable (S49.2A, motor de 18001
linhas). Por isso 4 das 5 skills foram vendorizadas NA ÍNTEGRA nesta sprint.

## Vendorizado nesta sprint (4 de 5 skills, byte-idêntico)

| Arquivo GStack | Caminho upstream | SHA-256 upstream | Status | Nota |
|---|---|---|---|---|
| `skills/obsidian-markdown/SKILL.md` | `skills/obsidian-markdown/SKILL.md` | `sha256:ef409b7eeda59e2e0c5cdead334dcc997dc9459d689859b3a610ffa9af5cabc5` | `unchanged` | Convenções de markdown do Obsidian (wikilinks, callouts, embeds, properties). |
| `skills/obsidian-markdown/references/CALLOUTS.md` | idem | `sha256:3b8f63c90f692ac40e6989fda2ab2fed3bb482ff515176b40d18dac8402e516b` | `unchanged` | |
| `skills/obsidian-markdown/references/EMBEDS.md` | idem | `sha256:d9f9f485ded6a32b4d76e59eaddc442bd09faf851d755f052759fc9ab1a25b2c` | `unchanged` | |
| `skills/obsidian-markdown/references/PROPERTIES.md` | idem | `sha256:28da58935ca3296f30b7e9aa25f2a695963dc0a3e4062638428d3bcb2094562a` | `unchanged` | |
| `skills/obsidian-bases/SKILL.md` | `skills/obsidian-bases/SKILL.md` | `sha256:83bc04a2c306a61c216c0cfecbb4d032cc763896623d229cd2a6dab811083032` | `unchanged` | Formato `.base` (YAML). |
| `skills/obsidian-bases/references/FUNCTIONS_REFERENCE.md` | idem | `sha256:0d0cd128bc5070ef1aba2baef41bd55b31b3f56961975934d7a5172396ca0006` | `unchanged` | Auditado: 1 falso-positivo verificado do classificador (`format()` de API, não comando destrutivo). |
| `skills/json-canvas/SKILL.md` | `skills/json-canvas/SKILL.md` | `sha256:788535277bc5f460bec97d467615a2ce97e2957dad1b1fc961e645f64c827128` | `unchanged` | Formato `.canvas` (JSON Canvas Spec 1.0). |
| `skills/json-canvas/references/EXAMPLES.md` | idem | `sha256:c6fce2e043f98d5bf3c52662a0261aa3e12d5eabbb37585e3c4c52a968b109a1` | `unchanged` | |
| `skills/obsidian-cli/SKILL.md` | `skills/obsidian-cli/SKILL.md` | `sha256:b4d398c64e086d84cfd51bed896b9bdc243a5fd8a9ea2815a261cd9cb4da3155` | `unchanged` | Requer Obsidian aberto — GStack nunca abre o app sozinho (invariante permanente). |

## Explicitamente NÃO vendorizado ainda (backlog real)

| Skill upstream | Linhas | Motivo real de adiamento |
|---|---:|---|
| `skills/defuddle/SKILL.md` | 41 | **Achado real do auditor** (`src/skills/external-audit.js`, reusado): linha 10 instrui `npm install -g defuddle` — instalação GLOBAL. Conflita com a invariante permanente do projeto ("nada instalado globalmente sem confirmação explícita do usuário"). Vendorizar exigiria REESCREVER essa instrução (nunca copiar verbatim uma instrução de auto-install global) ou decidir um caminho alternativo (ex.: `npx defuddle` sob Secrets Broker) — decisão explícita do usuário antes de prosseguir, não tomada nesta sprint. A rota `ingest_webpage` existe em `obsidian-skill-routes.js` mas aponta `status:"not_yet_vendored"`, nunca fabricado como disponível. |

## Falsos-positivos verificados do auditor (não são achados de risco real)

O `auditExternalSkills` (PRD29/34, reusado sem modificação) tem um regex `format\s` para
detectar comandos destrutivos de disco (ex. `format C:`). Nestes dois arquivos ele casou
com a palavra "Format" numa tabela de referência de API (`obsidian-bases/references/
FUNCTIONS_REFERENCE.md`, a função `format()` do Moment.js) e num cabeçalho de tabela
markdown (`defuddle/SKILL.md`, coluna "Format"). Verificado manualmente linha a linha —
nenhum comando de formatação de disco real existe nesses arquivos. O regex do auditor NÃO
foi alterado nesta sprint (fora de escopo; usado como está, mesmo com esse falso-positivo
conhecido).

## Regra de atualização

Todo novo arquivo copiado precisa de uma entrada nesta tabela ANTES do commit que o
adiciona. Revisão de drift/atualização/revogação é responsabilidade do pipeline PRD46
(`src/skills/source-lock.js`/`discovery.js`).
