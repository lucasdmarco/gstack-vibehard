# Contributing — gstack_vibehard

Obrigado por contribuir. O padrão é world-class e determinístico.

## Princípios
- **Zero/mínima dependência runtime.** O pacote publicado não deve ganhar deps sem necessidade forte. devDeps (typescript/c8) são dev-only.
- **Testar ABUSO, não só feature.** Toda mudança de segurança/runtime precisa de teste do caminho de abuso (injeção, traversal, leak, adulteração), não só do caminho feliz.
- **Honestidade.** Se um gate está indisponível, o status é *blocked*, não *passed*. Sem claim de enforcement onde só há instrução.

## Ritual de release (cada mudança publicável)
1. `git checkout -b <branch>` (nunca direto no `master`).
2. Testes: `npm test` · `npm run test:py` · `npm run lint` · `npm run syntaxcheck` · `npm run test:pack` · `npm run coverage:ci`.
3. `npm version <x>` (dispara o sync do `QG_VERSION`).
4. Atualizar `CHANGELOG.md`.
5. `node src/index.js publish-guard` → deve dizer **PRONTO**.
6. `git merge --no-ff` no `master`.
7. `npm publish --access public` · `git tag vX` · `gh release create`.
8. **CI verde** nos jobs (test/pytest/lint/templates/coverage/CodeQL).

## Qualidade
- `gstack_vibehard qa` (lentes determinísticas sobre o diff) antes de entregar.
- `gstack_vibehard dream audit` deve refletir a realidade (sem PLACEBO).
- Agentes: nunca editar `agents/generated/` à mão — edite `core/`/`knowledge/`/`agents/agents/` e rode `npm run build:agents`.

## Reportar segurança
Falhas de segurança: **não** abra issue pública — veja [`SECURITY.md`](SECURITY.md).
