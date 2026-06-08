#!/usr/bin/env node
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..", "..")
const GENERATED_DIR = path.join("agents", "generated")

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    check: false,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--root") {
      options.root = path.resolve(argv[++i] || "")
    } else if (arg === "--check") {
      options.check = true
    } else if (arg === "--dry-run") {
      options.dryRun = true
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

  return `# ${agent.id}\n\n> Gerado automaticamente por scripts/scripts/build_agents.js. Nao edite este arquivo manualmente; edite core/, knowledge/ ou ${relativeAgent}.\n\n## Descricao\n\n${agent.description}\n\n## Agente Fonte\n\n${agent.body}\n\n${coreText}\n\n${knowledgeText}\n`.trim() + "\n"
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

    cursorIndex.push({ ...agent, source })
    log(`${agent.id}: ${matchedKnowledge.length} knowledge pack(s)`)
  }

  const cursorAgentsPath = path.join(generatedRoot, "cursor", "AGENTS.md")
  if (await writeText(cursorAgentsPath, renderCursorAgents(cursorIndex), options)) changed += 1

  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/scripts/build_agents.js",
    agents: agents.length,
    core: coreBlocks.map((block) => path.relative(root, block.file).replaceAll("\\", "/")),
    knowledge: knowledgeBlocks.map((block) => path.relative(root, block.file).replaceAll("\\", "/")),
    outputs: [
      "agents/generated/claude/<agent>/SKILL.md",
      "agents/generated/codex/<agent>.toml",
      "agents/generated/cursor/AGENTS.md",
      "agents/generated/cursor/rules/<agent>.mdc",
    ],
  }
  if (await writeText(path.join(generatedRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, options)) changed += 1

  log(`concluido: ${agents.length} agente(s), ${changed} arquivo(s) alterado(s)`)
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
