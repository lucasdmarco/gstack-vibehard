import { readFileSync } from "fs"
import { join } from "path"
import { execFileSync as defaultExec } from "child_process"

/**
 * diff-hygiene — varredura determinística APENAS dos arquivos mudados (git).
 *
 * Agnóstica de arquétipo, sem LLM, sem rede. Pega o que costuma escapar antes de
 * commit/publish. NÃO flagra `console.log` — numa CLI o stdout é o produto
 * (lição de arquétipo); foca em sinais de alto valor e baixo falso-positivo.
 *
 * Severidade: HIGH (debugger, segredo, `.only`) bloqueia em modo enforce; MEDIUM
 * (catch vazio, `.skip`) e LOW (TODO/FIXME) são avisos.
 *
 * @returns {{ status:"clean"|"warn"|"fail", findings:Array, scannedFiles:string[], high:number }}
 */
const SOURCE_EXT = /\.(jsx?|tsx?|mjs|cjs)$/
const isTest = (f) => /(^|\/)tests?\//.test(f) || /\.(test|spec)\./.test(f) || /__tests__/.test(f)
const isSource = (f) => SOURCE_EXT.test(f) && !f.includes("node_modules")

const SECRET_PATTERNS = [
  { rule: "aws-key", re: /AKIA[0-9A-Z]{16}/, msg: "possível AWS Access Key hardcoded" },
  { rule: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, msg: "bloco de chave privada" },
  { rule: "github-token", re: /\bghp_[A-Za-z0-9]{36}\b/, msg: "possível GitHub token" },
  { rule: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, msg: "possível Slack token" },
]

export function diffHygiene(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const exec = opts.exec || defaultExec
  const changed = opts.files || listChanged(cwd, exec)
  const findings = []
  const scannedFiles = []

  for (const rel of changed) {
    if (!isSource(rel)) continue
    let content
    try { content = readFileSync(join(cwd, rel), "utf-8") } catch { continue }
    scannedFiles.push(rel)
    const test = isTest(rel)
    content.split("\n").forEach((line, i) => {
      const ln = i + 1
      if (/(?:^|\s|;)debugger\s*;?\s*$/.test(line)) push(findings, rel, ln, "HIGH", "debugger", "statement `debugger` esquecido")
      if (test && /\b(?:describe|it|test)\.only\s*\(/.test(line)) push(findings, rel, ln, "HIGH", "test-only", "`.only` em teste — esconde os demais no CI")
      if (test && /\b(?:describe|it|test)\.skip\s*\(/.test(line)) push(findings, rel, ln, "MEDIUM", "test-skip", "`.skip` em teste")
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) push(findings, rel, ln, "MEDIUM", "empty-catch", "catch vazio engole o erro")
      for (const s of SECRET_PATTERNS) if (s.re.test(line)) push(findings, rel, ln, "HIGH", s.rule, s.msg)
      if (!test && /\b(?:TODO|FIXME|XXX)\b/.test(line)) push(findings, rel, ln, "LOW", "todo", "TODO/FIXME em código publicável")
    })
  }

  const high = findings.filter((f) => f.severity === "HIGH").length
  return { status: high ? "fail" : findings.length ? "warn" : "clean", findings, scannedFiles, high }
}

function listChanged(cwd, exec) {
  try {
    const out = String(exec("git", ["status", "--porcelain"], { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15000 }) || "")
    return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.split(" -> ").pop())
  } catch { return [] }
}

function push(arr, file, line, severity, rule, message) {
  arr.push({ file, line, severity, rule, message })
}
