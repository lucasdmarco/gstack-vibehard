# Fallow baselines — release gate por REGRESSÃO (honesto)

Estes arquivos definem a **linha de base** do Fallow. O gate (`npx fallow audit`, usado
por `hooks/hooks/qg.py` e `stop.py`) passa a **falhar só em regressão nova** — dead-code,
duplicação ou complexidade **introduzidos além** desta linha de base.

## Por que baseline (e não deleção)

O verdict completo do Fallow falhava por débito **majoritariamente arquitetural**, não
por dead-code deletável:

- **~90 "unused exports/files" são falsos-positivos** do padrão de teste deste repo: os
  testes carregam módulos por **dynamic import** (`imp("path")` com cache-bust), que a
  análise estática do Fallow **não rastreia**. O código É consumido — só não por `import`
  estático. Deletar quebraria a suíte (ex.: `src/meta/command-layers.js`,
  `src/plugins/opencode/gstack-session.js` são usados por testes/runtime).
- **20 circular dependencies + ~290 complexity findings** são débito legado, fora do
  escopo de "dead-code/dup".

Baseline é o mecanismo **sancionado pelo próprio Fallow** para exatamente isto. **Não é
"zero findings"** — é **"sem débito NOVO"**. Não afirmar "Fallow 100% limpo".

## Regenerar (quando o débito aceito mudar de propósito)

```bash
npx fallow dead-code --save-baseline .fallow-baselines/dead-code.json
npx fallow dupes     --save-baseline .fallow-baselines/dupes.json
npx fallow health    --save-baseline .fallow-baselines/health.json
```

Config em `.fallowrc.jsonc` (`audit.deadCodeBaseline`/`dupesBaseline`/`healthBaseline`).
Guard: `tests/fallow_baseline_config.test.js` impede desabilitar o gate silenciosamente.
