# Obsidian skills: 4 de 5, roteadas por intent, vault nunca escapa

`kepano/obsidian-skills` (MIT) é um repo pequeno e real — 5 skills declarativas, ~1777
linhas totais. 4 delas foram vendorizadas byte-a-byte nesta sprint via o pipeline REAL do
PRD46 (`src/skills/source-lock.js`), não um manifest inventado.

## Rotas

| Intent | Skill | Gate | Status |
|---|---|---|---|
| escrever/linkar nota | `obsidian-markdown` | vault-boundary + syntax | vendorizado |
| criar `.base` | `obsidian-bases` | YAML/schema + advisory de render | vendorizado |
| criar `.canvas` | `json-canvas` | JSON schema + integridade de nó/aresta | vendorizado |
| operar app rodando | `obsidian-cli` | doctor de app/CLI + aprovação p/ mutação | vendorizado |
| ingerir webpage | `defuddle` | consentimento de rede + proveniência + scan de prompt-injection | **não vendorizado** |

`routeObsidianIntent(intent)` (`src/skills/obsidian-skill-routes.js`) nunca retorna mais
de uma skill por intent — é o que garante que só a skill que casa entra no context pack.

## Por que `defuddle` ficou de fora

O auditor real (`src/skills/external-audit.js`, reusado sem modificação) achou uma
instrução de **instalação global** no upstream: `npm install -g defuddle` (linha 10 do
SKILL.md). Isso conflita com a invariante permanente do projeto — nada é instalado
globalmente sem confirmação explícita. Vendorizar exigiria reescrever essa instrução
(nunca copiar verbatim um auto-install global) ou decidir um caminho alternativo — decisão
explícita do usuário, não tomada nesta sprint. `routeObsidianIntent("ingest_webpage")`
retorna a rota com `status: "not_yet_vendored"`, nunca fabricado como pronto.

## Vault nunca escapa, `.env*` nunca entra

`canWriteToVault({ vaultRoot, targetPath, relPath })` recusa qualquer escrita que:
- resolva para fora de `vaultRoot` (path traversal `../`, caminho absoluto);
- toque um caminho `.env`/`.env.local`/aninhado.

## Limite honesto desta versão

- O gate `obsidian-vault-boundary-gate` (`gate-matrix.js`) é **declarado, não
  implementado** — `canWriteToVault` é real e testado, mas nenhum comando `obsidian`
  existe ainda que o chame. Citar `implementedBy` sem um consumidor real faria
  `gate-truth.js` computar `enforced:true` falsamente (mesmo cuidado do
  `minimality-gate`, S49.5).
- "Agent Factory source mappings" e "context Obsidian doctor/status" (itens do plano
  original) não foram wireados nesta sprint — backlog explícito, não fabricado.
- GStack nunca abre o Obsidian, nunca cria um cofre, nunca varre um vault global
  implicitamente (invariante permanente — detectar ≠ indexar).
