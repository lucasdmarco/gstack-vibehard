/**
 * QA Multi-Lens (PRD 12 B2 / PRD 13 §10.4 — auditores determinísticos). Lentes
 * DETERMINÍSTICAS (sem LLM, sem rede) sobre os arquivos mudados, COMPLEMENTANDO o
 * `diff-hygiene` (segredo/debugger/.only). Alinhadas ao ultracode.md: zero eval,
 * zero `any`, zero bare except, zero query sem limit, zero exec shell. LLM é só
 * sinal; o veredito é determinístico. PURO/testável.
 *
 * Severidade: CRITICO/ALTO bloqueiam (strict ou sempre, conforme o gate); MEDIO/BAIXO
 * avisam. Baixo falso-positivo é prioridade (lente só dispara em sinal claro).
 */

const reLine = (re) => ({ test: (line) => re.test(line) })

export const QA_LENSES = Object.freeze([
  // ── Segurança ──
  { id: "eval", lens: "security", severity: "ALTO", langs: ["js", "ts"], match: reLine(/\beval\s*\(/), msg: "execução dinâmica de código com eval" },
  { id: "new-function", lens: "security", severity: "ALTO", langs: ["js", "ts"], match: reLine(/\bnew\s+Function\s*\(/), msg: "execução dinâmica de código via construtor Function" },
  { id: "shell-exec", lens: "security", severity: "ALTO", langs: ["js", "ts"], match: reLine(/\bexec(?:Sync)?\s*\(\s*[`'"][^`'"]*\$\{/), msg: "exec com string interpolada — risco de command injection (use argv + shell:false)" },
  { id: "shell-true", lens: "security", severity: "MEDIO", langs: ["js", "ts"], match: reLine(/shell\s*:\s*true/), msg: "spawn/exec usando o shell do SO — prefira argv sem shell" },
  // ── Tipos (ultracode: zero any) ──
  { id: "any-type", lens: "types", severity: "MEDIO", langs: ["ts"], match: reLine(/(:\s*any\b|\bas\s+any\b)/), msg: "tipo `any` — ultracode pede zero any" },
  // ── Erros (ultracode: zero bare except) ──
  { id: "bare-except", lens: "errors", severity: "MEDIO", langs: ["py"], match: reLine(/^\s*except\s*:\s*$/), msg: "bare `except:` — capture exceções específicas" },
  // ── Performance (ultracode: zero query sem limit) ──
  { id: "unbounded-query", lens: "perf", severity: "MEDIO", langs: ["js", "ts"], match: reLine(/\.findMany\s*\(\s*\)/), msg: "findMany() sem filtro/limite — query potencialmente ilimitada" },
  // SQL cru por regex de linha dá falso-positivo (ex.: `import { select } from`) — a
  // lente unbounded-query (ORM) cobre o caso real sem o ruído. Mantido fora do gate.
])

const LANG_BY_EXT = { js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "ts", tsx: "ts", py: "py" }
function langOf(rel) {
  const ext = String(rel).split(".").pop().toLowerCase()
  return LANG_BY_EXT[ext] || null
}
const isTest = (f) => /(^|\/)tests?\//.test(f) || /\.(test|spec)\./.test(f) || /__tests__/.test(f)

/** Escaneia um arquivo com as lentes aplicáveis à sua linguagem. → findings[]. */
export function scanFileLenses(rel, content, lenses = QA_LENSES) {
  const lang = langOf(rel)
  if (!lang || isTest(rel)) return [] // testes legitimamente usam any/eval em fixtures
  const findings = []
  const lines = String(content == null ? "" : content).split("\n")
  for (const lens of lenses) {
    if (!lens.langs.includes(lang)) continue
    for (let i = 0; i < lines.length; i++) {
      if (lens.match.test(lines[i])) {
        findings.push({ file: rel, id: lens.id, lens: lens.lens, severity: lens.severity, line: i + 1, msg: lens.msg })
        break // uma ocorrência por lente/arquivo já basta pro gate
      }
    }
  }
  return findings
}

/** Roda as lentes num conjunto de arquivos. `files`: [{rel, content}]. */
export function runQaLenses(files, lenses = QA_LENSES) {
  const out = []
  for (const f of files || []) out.push(...scanFileLenses(f.rel, f.content, lenses))
  return out
}

/**
 * Avalia o gate QA. `strict` bloqueia MEDIO além de ALTO/CRITICO. → {critical, high,
 * medium, blocked, verdict, byLens}.
 */
export function evaluateQa(findings, { strict = false } = {}) {
  const f = findings || []
  const critical = f.filter((x) => x.severity === "CRITICO").length
  const high = f.filter((x) => x.severity === "ALTO").length
  const medium = f.filter((x) => x.severity === "MEDIO").length
  const blocked = critical > 0 || high > 0 || (strict && medium > 0)
  const byLens = {}
  for (const x of f) byLens[x.lens] = (byLens[x.lens] || 0) + 1
  return { critical, high, medium, low: f.length - critical - high - medium, blocked, byLens, verdict: blocked ? "BLOQUEADO" : (f.length ? "AVISOS" : "LIMPO") }
}
