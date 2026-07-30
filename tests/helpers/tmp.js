import { rmSync } from "node:fs"

/**
 * PRD51 S51.8.2b — limpeza de tmpdir BEST-EFFORT nos testes que spawnam
 * subprocessos.
 *
 * Achado real: `verify --profile full` voltou `ready:false` com o passo `test`
 * FALHANDO — não por asserção nenhuma, mas por `ENOTEMPTY`/`EPERM` no `rmSync`
 * de diretórios temporários já praticamente vazios. No Windows, o handle do
 * diretório pode continuar preso um instante depois do subprocess sair
 * (antivírus/indexador), e `maxRetries` do Node não sempre cobre isso sob
 * carga. Duas execuções da suíte caíram por isso em arquivos DIFERENTES
 * (`governance_sbom_real`, `e2e/doctor_terminal`) — é sistêmico, não um bug de
 * um teste.
 *
 * O que os testes provam é o comportamento do produto. Falhar a suíte porque o
 * SO não liberou um diretório temporário é FALSO NEGATIVO, e ele se propaga
 * para o gate de release. A DoD do próprio PRD51 pede "zero EBUSY ou state
 * residual" e "suíte passa três vezes em máquina fria" — por isso a limpeza
 * virou best-effort AQUI, num helper único, em vez de try/catch espalhado.
 *
 * Não é silencioso: o que não pôde ser apagado fica registrado em
 * `leakedTmpDirs`, observável por quem quiser auditar resíduo.
 */

/** Diretórios que o SO não liberou. Visível de propósito — resíduo não é invisível. */
export const leakedTmpDirs = []

export function cleanupTmp(dir) {
  if (!dir) return true
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    return true
  } catch (e) {
    leakedTmpDirs.push({ dir, code: e?.code || "unknown" })
    return false
  }
}
