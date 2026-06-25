import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { stripBom } from "../util/json.js"

/**
 * Detecção de ARQUÉTIPO de projeto (determinística, sem LLM, sem rede).
 *
 * É a peça-base que deixa o gstack adaptar gates, ruleset do QG e hints ao TIPO
 * de projeto — em vez de assumir "site/SaaS" em todo lugar. Lê só `package.json`
 * + presença de poucos arquivos no `cwd`.
 *
 * profile ∈ library | cli | web-app | service | mobile-backend | data-ml | monorepo | unknown
 *
 * Ordem de precedência (mais específico primeiro): monorepo → web-app →
 * mobile-backend → service → cli → library → data-ml → unknown.
 *
 * @returns {{ profile: string, signals: string[], hasPkg: boolean, alsoLibrary?: boolean }}
 */
export function detectProfile(cwd = process.cwd()) {
  const signals = []
  const pkg = readJson(join(cwd, "package.json"))
  const hasPkg = !!pkg
  const deps = pkg
    ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) }
    : {}
  const anyDep = (...names) => names.some((n) => Object.prototype.hasOwnProperty.call(deps, n))
  const file = (...files) => files.some((f) => existsSync(join(cwd, f)))
  const publishable = !!(pkg && (pkg.main || pkg.module || pkg.exports) && pkg.private !== true)

  // monorepo — workspaces / ferramentas de monorepo
  if ((pkg && pkg.workspaces) || file("pnpm-workspace.yaml", "turbo.json", "lerna.json", "nx.json")) {
    signals.push("workspaces/turbo/pnpm/nx")
    return { profile: "monorepo", signals, hasPkg }
  }

  // web-app — framework de front-end
  if (anyDep("next", "vite", "react", "react-dom", "@angular/core", "svelte", "astro", "nuxt", "vue", "solid-js")) {
    signals.push("framework de front-end")
    return { profile: "web-app", signals, hasPkg }
  }

  // mobile-backend — Expo/React Native (backend de app mobile)
  if (anyDep("expo", "react-native")) {
    signals.push("expo/react-native")
    return { profile: "mobile-backend", signals, hasPkg }
  }

  // service — servidor backend ou containerizado (sem front)
  if (anyDep("express", "fastify", "hono", "@nestjs/core", "koa", "@hapi/hapi") || file("Dockerfile")) {
    signals.push("framework de servidor / Dockerfile")
    return { profile: "service", signals, hasPkg }
  }

  // cli — tem binário publicado (pode ser também biblioteca)
  if (pkg && pkg.bin) {
    signals.push("campo bin")
    return { profile: "cli", signals, hasPkg, alsoLibrary: publishable }
  }

  // library — pacote publicável (main/module/exports, não private)
  if (publishable) {
    signals.push("publicável (main/module/exports, não private)")
    return { profile: "library", signals, hasPkg }
  }

  // data-ml — projeto Python sem front (depois do JS, p/ não roubar lib/cli)
  if (file("requirements.txt", "pyproject.toml", "environment.yml", "Pipfile")) {
    signals.push("projeto Python (requirements/pyproject)")
    return { profile: "data-ml", signals, hasPkg }
  }

  signals.push(hasPkg ? "package.json sem sinais fortes" : "sem package.json")
  return { profile: "unknown", signals, hasPkg }
}

function readJson(p) {
  try { return JSON.parse(stripBom(readFileSync(p, "utf-8"))) } catch { return null }
}
