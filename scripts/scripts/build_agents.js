#!/usr/bin/env node
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execSync, execFileSync } from "node:child_process"
import { withExecutionContract, buildManifestV2 } from "../../src/agents/factory.js"
import { scanFiles, evaluateScan } from "../../src/agents/scanner.js"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..", "..")
const GENERATED_DIR = path.join("agents", "generated")

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    check: false,
    dryRun: false,
    strict: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--root") {
      options.root = path.resolve(argv[++i] || "")
    } else if (arg === "--check") {
      options.check = true
    } else if (arg === "--dry-run") {
      options.dryRun = true
    } else if (arg === "--strict") {
      options.strict = true
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Flag desconhecida: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`build_agents.js\n\nUso:\n  node scripts/scripts/build_agents.js\n  node scripts/scripts/build_agents.js --root <projeto>\n  node scripts/scripts/build_agents.js --check\n\nGera adaptadores seguros em agents/generated/.`)
}

function log(message) {
  console.log(`[build:agents] ${message}`)
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    throw new Error(`Falha lendo ${filePath}: ${error.message}`)
  }
}

async function writeText(filePath, content, options) {
  if (options.dryRun) {
    log(`dry-run write ${path.relative(options.root, filePath)}`)
    return false
  }

  const previous = existsSync(filePath) ? await fs.readFile(filePath, "utf8") : null
  if (previous === content) return false

  if (options.check) {
    throw new Error(`Saida gerada desatualizada: ${path.relative(options.root, filePath)}`)
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
  return true
}

async function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const current = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "node_modules" || entry.name.startsWith(".")) continue
      files.push(...await listMarkdownFiles(current))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(current)
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: text.trim() }

  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf(":")
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const rawValue = trimmed.slice(idx + 1).trim()
    meta[key] = parseMetaValue(rawValue)
  }

  return { meta, body: match[2].trim() }
}

function parseMetaValue(value) {
  const unquoted = value.replace(/^['"]|['"]$/g, "")
  if (unquoted.toLowerCase() === "true") return true
  if (unquoted.toLowerCase() === "false") return false
  if (unquoted.includes(",")) {
    return unquoted.split(",").map((item) => item.trim()).filter(Boolean)
  }
  return unquoted
}

function slugFromFile(filePath) {
  return path.basename(filePath, ".md").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function normalizeList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value).split(",").map((item) => item.trim()).filter(Boolean)
}

function asString(value, fallback = "") {
  if (value === undefined || value === null) return fallback
  if (Array.isArray(value)) return value.join(", ")
  return String(value)
}

async function loadCore(root) {
  const files = await listMarkdownFiles(path.join(root, "core"))
  if (files.length === 0) throw new Error("Nenhum arquivo Markdown encontrado em core/")

  const blocks = []
  for (const file of files) {
    blocks.push({
      id: slugFromFile(file),
      file,
      title: path.relative(root, file).replaceAll("\\", "/"),
      body: (await readText(file)).trim(),
    })
  }
  return blocks
}

async function loadKnowledge(root) {
  const files = await listMarkdownFiles(path.join(root, "knowledge"))
  if (files.length === 0) throw new Error("Nenhum arquivo Markdown encontrado em knowledge/")

  const blocks = []
  for (const file of files) {
    const parsed = parseFrontmatter(await readText(file))
    const id = asString(parsed.meta.id, slugFromFile(file))
    blocks.push({
      id,
      file,
      meta: parsed.meta,
      title: path.relative(root, file).replaceAll("\\", "/"),
      tags: normalizeList(parsed.meta.tags || id),
      appliesTo: normalizeList(parsed.meta.applies_to || parsed.meta.appliesTo),
      body: parsed.body,
    })
  }
  return blocks
}

async function loadAgents(root) {
  const dir = path.join(root, "agents", "agents")
  const files = await listMarkdownFiles(dir)
  if (files.length === 0) throw new Error("Nenhum agente encontrado em agents/agents/")

  const agents = []
  for (const file of files) {
    const parsed = parseFrontmatter(await readText(file))
    const id = asString(parsed.meta.name, slugFromFile(file)).toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    const description = asString(parsed.meta.description, `Agente ${id}`)
    agents.push({
      id,
      file,
      meta: parsed.meta,
      description,
      body: parsed.body,
      tools: normalizeList(parsed.meta.tools),
      skills: normalizeList(parsed.meta.skills),
      model: asString(parsed.meta.model, "inherit"),
    })
  }

  return agents
}

function knowledgeAgentToAgent(block) {
  const id = asString(block.meta.name || block.meta.id, block.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  return {
    id,
    file: block.file,
    meta: block.meta,
    description: asString(block.meta.description, `Agente ${id}`),
    body: block.body,
    tools: normalizeList(block.meta.tools || "Read, Grep, Glob, Bash"),
    skills: normalizeList(block.meta.skills),
    model: asString(block.meta.model, "inherit"),
  }
}

function isKnowledgeAgent(block) {
  return block.meta?.agent === true || String(block.meta?.agent || "").toLowerCase() === "true"
}

function knowledgeMatchesAgent(knowledge, agent) {
  if (knowledge.appliesTo.length > 0) {
    const explicitTargets = knowledge.appliesTo.map((value) => String(value).toLowerCase())
    return explicitTargets.includes("all") || explicitTargets.includes("*") || explicitTargets.includes(agent.id.toLowerCase())
  }

  const haystack = [
    agent.id,
    agent.description,
    agent.body.slice(0, 2000),
    ...agent.tools,
    ...agent.skills,
  ].join(" ").toLowerCase()

  return [knowledge.id, ...knowledge.tags]
    .map((value) => String(value).toLowerCase())
    .some((token) => token && haystack.includes(token))
}

function renderInstruction(agent, coreBlocks, knowledgeBlocks, root) {
  const relativeAgent = path.relative(root, agent.file).replaceAll("\\", "/")
  const coreText = coreBlocks.map((block) => `## Core: ${block.title}\n\n${block.body}`).join("\n\n")
  const knowledgeText = knowledgeBlocks.length > 0
    ? knowledgeBlocks.map((block) => `## Knowledge: ${block.title}\n\n${block.body}`).join("\n\n")
    : "## Knowledge\n\nNenhum pacote de knowledge especifico foi encontrado para este agente. Use apenas as regras core e o agente fonte."

  const instruction = `# ${agent.id}\n\n> Gerado automaticamente por gstack_vibehard agents build. Nao edite este arquivo manualmente; edite core/, knowledge/ ou ${relativeAgent}.\n\n## Descricao\n\n${agent.description}\n\n## Agente Fonte\n\n${agent.body}\n\n${coreText}\n\n${knowledgeText}\n`.trim() + "\n"
  // Execution Contract GStack (PRD 13 §8.6): bloco imutável no FIM de todo adapter.
  return withExecutionContract(instruction)
}

function yamlScalar(value) {
  return JSON.stringify(asString(value))
}

function yamlArray(values) {
  const items = normalizeList(values)
  if (items.length === 0) return "[]"
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`
}

function renderClaudeSkill(agent, instruction) {
  return `---\nname: ${agent.id}\ndescription: ${yamlScalar(agent.description)}\ntools: ${yamlArray(agent.tools)}\nmodel: ${yamlScalar(agent.model)}\n---\n\n${instruction}`
}

function tomlString(value) {
  return JSON.stringify(asString(value))
}

function tomlArray(values) {
  return `[${normalizeList(values).map(tomlString).join(", ")}]`
}

function tomlMultiline(value) {
  return `"""${String(value).replaceAll('"""', '\\\"\\\"\\\"')}"""`
}

function renderCodexToml(agent, instruction) {
  return [
    `name = ${tomlString(agent.id)}`,
    `description = ${tomlString(agent.description)}`,
    `model = ${tomlString(agent.model)}`,
    `tools = ${tomlArray(agent.tools)}`,
    `skills = ${tomlArray(agent.skills)}`,
    "",
    `[instructions]`,
    `instructions = ${tomlMultiline(instruction)}`,
  ].join("\n") + "\n"
}

function renderCursorRule(agent, instruction) {
  return `---\ndescription: ${yamlScalar(agent.description)}\nalwaysApply: false\n---\n\n${instruction}`
}

function renderCursorAgents(agents) {
  const lines = [
    "# GStack VibeHard Generated Agents",
    "",
    "Gerado automaticamente por `node scripts/scripts/build_agents.js`.",
    "Use os arquivos em `rules/` para contexto especifico por agente.",
    "",
  ]

  for (const agent of agents) {
    lines.push(`## ${agent.id}`)
    lines.push("")
    lines.push(agent.description)
    lines.push("")
    lines.push(`- Cursor rule: rules/${agent.id}.mdc`)
    lines.push(`- Source: ${agent.source}`)
    lines.push("")
  }

  return lines.join("\n")
}

/** Arquivo combinado (copilot/gemini): índice de agentes + Execution Contract. */
function renderCombinedInstructions(title, agents) {
  const lines = [
    `# ${title}`,
    "",
    "Gerado automaticamente por gstack_vibehard agents build. Nao edite manualmente; edite core/, knowledge/ ou agents/agents/.",
    "",
    "## Agentes",
    "",
  ]
  for (const agent of agents) {
    lines.push(`### ${agent.id}`, "", agent.description, "", `- Source: ${agent.source}`, "")
  }
  return withExecutionContract(lines.join("\n"))
}

function rel(root, p) {
  return path.relative(root, p).replaceAll("\\", "/")
}

async function readCompilerVersion(root) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
    return pkg.version || "0.0.0"
  } catch { return "0.0.0" }
}

async function collectSourceFiles(root, absDir) {
  const out = []
  for (const file of await listMarkdownFiles(absDir)) {
    out.push({ rel: rel(root, file), content: await readText(file) })
  }
  return out
}

/** Coleta {rel, content} de .md de um conjunto de dirs (para o scanner). */
async function collectScanFiles(root, subdirs) {
  const files = []
  for (const sub of subdirs) {
    const dir = path.join(root, ...sub)
    if (!existsSync(dir)) continue
    for (const file of await listMarkdownFiles(dir)) files.push({ rel: rel(root, file), content: await readText(file) })
  }
  return files
}

/** Sumário de segurança DETERMINÍSTICO sobre a FONTE (igual em build e --check). */
async function builtinSecuritySummary(root) {
  const files = await collectScanFiles(root, [["core"], ["knowledge"], ["agents", "agents"]])
  const g = evaluateScan(scanFiles(files), { strict: false })
  return { scanner: "agentshield+builtin", verdict: g.critical > 0 ? "fail" : "pass", critical: g.critical, high: g.high }
}

async function generate(options) {
  const root = options.root
  const generatedRoot = path.join(root, GENERATED_DIR)
  const coreBlocks = await loadCore(root)
  const knowledgeBlocks = await loadKnowledge(root)
  const agents = await loadAgents(root)
  const existingIds = new Set(agents.map((agent) => agent.id))
  for (const block of knowledgeBlocks.filter(isKnowledgeAgent)) {
    const agent = knowledgeAgentToAgent(block)
    if (existingIds.has(agent.id)) continue
    agents.push(agent)
    existingIds.add(agent.id)
  }

  if (!options.dryRun && !options.check) {
    await fs.rm(generatedRoot, { recursive: true, force: true })
  }

  const cursorIndex = []
  const adapterFiles = { claude: [], codex: [], cursor: [] }
  let changed = 0

  for (const agent of agents) {
    const matchedKnowledge = knowledgeBlocks.filter((block) => block.file !== agent.file && knowledgeMatchesAgent(block, agent))
    const instruction = renderInstruction(agent, coreBlocks, matchedKnowledge, root)
    const source = path.relative(root, agent.file).replaceAll("\\", "/")

    const claudePath = path.join(generatedRoot, "claude", agent.id, "SKILL.md")
    const codexPath = path.join(generatedRoot, "codex", `${agent.id}.toml`)
    const cursorRulePath = path.join(generatedRoot, "cursor", "rules", `${agent.id}.mdc`)

    if (await writeText(claudePath, renderClaudeSkill(agent, instruction), options)) changed += 1
    if (await writeText(codexPath, renderCodexToml(agent, instruction), options)) changed += 1
    if (await writeText(cursorRulePath, renderCursorRule(agent, instruction), options)) changed += 1

    adapterFiles.claude.push(rel(root, claudePath))
    adapterFiles.codex.push(rel(root, codexPath))
    adapterFiles.cursor.push(rel(root, cursorRulePath))
    cursorIndex.push({ ...agent, source })
    log(`${agent.id}: ${matchedKnowledge.length} knowledge pack(s)`)
  }

  const cursorAgentsPath = path.join(generatedRoot, "cursor", "AGENTS.md")
  if (await writeText(cursorAgentsPath, renderCursorAgents(cursorIndex), options)) changed += 1
  adapterFiles.cursor.push(rel(root, cursorAgentsPath))

  // Adapters combinados (PRD 13 §8.4): Copilot e Gemini — instrucionais, com o
  // Execution Contract. Honesto: instruem, não bloqueiam (matriz em adapter-matrix.js).
  const copilotPath = path.join(generatedRoot, "copilot", "copilot-instructions.md")
  if (await writeText(copilotPath, renderCombinedInstructions("GStack VibeHard — Copilot Instructions", cursorIndex), options)) changed += 1
  const geminiPath = path.join(generatedRoot, "gemini", "GEMINI.md")
  if (await writeText(geminiPath, renderCombinedInstructions("GStack VibeHard — Gemini Agents", cursorIndex), options)) changed += 1
  adapterFiles.copilot = [rel(root, copilotPath)]
  adapterFiles.gemini = [rel(root, geminiPath)]

  // AgentShield/scan determinístico (gera report + BLOQUEIA crítico) ANTES do manifest.
  await securityScanGenerated(root, generatedRoot, options)

  // Manifest V2 (PRD 13 §8.3): hashes da fonte + adapter versions + security verdict.
  // DETERMINÍSTICO (sem generatedAt) → `--check` compara por igualdade sem ruído.
  const compilerVersion = await readCompilerVersion(root)
  const coreFiles = await collectSourceFiles(root, path.join(root, "core"))
  const knowledgeFiles = await collectSourceFiles(root, path.join(root, "knowledge"))
  const agentFiles = await collectSourceFiles(root, path.join(root, "agents", "agents"))
  const security = await builtinSecuritySummary(root)
  const manifest = buildManifestV2({ compilerVersion, coreFiles, knowledgeFiles, agentFiles, agentsCount: agents.length, adapters: adapterFiles, security })
  // Manifest com tratamento especial no --check: `compilerVersion` é INFORMATIVO
  // (versão do package) e NÃO conta como drift — senão todo bump de versão quebraria
  // o --check sem mudar a fonte. Compara o resto por igualdade.
  const manifestPath = path.join(generatedRoot, "manifest.json")
  const stableManifest = (m) => { if (!m) return null; const c = { ...m }; delete c.compilerVersion; return c }
  if (options.check) {
    const onDisk = existsSync(manifestPath) ? JSON.parse(await fs.readFile(manifestPath, "utf8")) : null
    if (!onDisk || JSON.stringify(stableManifest(onDisk)) !== JSON.stringify(stableManifest(manifest))) {
      throw new Error(`Saida gerada desatualizada: ${rel(root, manifestPath)} (manifest)`)
    }
  } else if (!options.dryRun) {
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    changed += 1
  }

  log(`concluido: ${agents.length} agente(s), ${changed} arquivo(s) alterado(s)`)
}

async function securityScanGenerated(root, generatedRoot, options) {
  const reportDir = path.join(root, "dist", "agents")
  const reportPath = path.join(reportDir, "security-report.json")

  // Escopo §9.1: fonte + gerado + skills. O scanner BUILTIN roda SEMPRE (build E
  // --check) — uma injeção commitada NÃO passa pelo gate do CI.
  const files = await collectScanFiles(root, [["core"], ["knowledge"], ["agents", "agents"], ["skills", "skills"]])
  if (existsSync(generatedRoot)) {
    for (const file of await listMarkdownFiles(generatedRoot)) files.push({ rel: rel(root, file), content: await readText(file) })
  }
  const findings = scanFiles(files)
  let coverage = "reduced"

  // ECC AgentShield é cobertura ADICIONAL (só em build real; nunca obrigatória). Sem
  // ela, o builtin determinístico SEGUE ativo e o verdict fica "cobertura reduzida".
  if (!options.check && !options.dryRun) {
    try {
      const coreDir = path.join(root, "core")
      const isWin = process.platform === "win32"
      const out = isWin
        ? execFileSync("cmd.exe", ["/c", "npx", "ecc-agentshield", "scan", "--dir", coreDir, "--json"], { timeout: 60000, encoding: "utf8", stdio: "pipe" })
        : execFileSync("npx", ["ecc-agentshield", "scan", "--dir", coreDir, "--json"], { timeout: 60000, encoding: "utf8", stdio: "pipe" })
      const ecc = JSON.parse(out)
      findings.push(...(ecc.findings || []))
      coverage = "full"
      log(`ecc-agentshield: ${ecc.summary || "scan complete"} (cobertura full)`)
    } catch (e) {
      log(`ecc-agentshield indisponível (${e.message.split("\n")[0]}) — cobertura REDUZIDA (builtin segue ativo)`)
    }
  }

  const gate = evaluateScan(findings, { strict: options.strict, coverage })
  const report = {
    schemaVersion: 2,
    scannedAt: new Date().toISOString(),
    scanner: "agentshield+builtin",
    coverage,
    strict: !!options.strict,
    summary: { total: findings.length, critical: gate.critical, high: gate.high, blocked: gate.blocked },
    findings,
    verdict: gate.verdict,
  }

  if (!options.dryRun && !options.check) {
    await fs.mkdir(reportDir, { recursive: true })
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")
    log(`Security report: ${path.relative(root, reportPath)} (${report.verdict})`)
  }

  if (gate.blocked) {
    log(`AgentShield BLOQUEADO: ${gate.critical} CRITICO, ${gate.high} ALTO${options.strict ? " (strict)" : ""}`)
    for (const f of findings.filter((x) => x.severity === "CRITICO" || (options.strict && x.severity === "ALTO"))) {
      console.error(`  [${f.severity}] ${f.file}:${f.line} ${f.description}`)
    }
    if (!options.dryRun) throw new Error(`AgentShield bloqueou: ${gate.critical} CRITICO${options.strict ? `, ${gate.high} ALTO` : ""}`)
  } else {
    log(`AgentShield: ${findings.length} finding(s), ${gate.critical} CRITICO, ${gate.high} ALTO — ${gate.verdict} (cobertura ${coverage})`)
  }

  return report
}


async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.root)) throw new Error(`Root nao encontrado: ${options.root}`)
  await generate(options)
}

main().catch((error) => {
  console.error(`[build:agents] ERRO: ${error.message}`)
  process.exit(1)
})
