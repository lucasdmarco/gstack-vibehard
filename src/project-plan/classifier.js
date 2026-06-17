/**
 * Classificador determinístico (sem LLM): mapeia um objetivo textual para uma
 * recipe por contagem de keywords. Empate → ordem das RECIPES (estável).
 * Nenhuma keyword casada → recipe default (web-app), score 0.
 */
import { RECIPES, DEFAULT_RECIPE_ID } from "./recipes.js"

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
}

/**
 * @returns {{ recipeId, score, matched: string[] }}
 */
export function classify(objective) {
  const hay = normalize(objective)
  let best = { recipeId: DEFAULT_RECIPE_ID, score: 0, matched: [] }
  for (const r of RECIPES) {
    const matched = r.intentKeywords.filter((kw) => hay.includes(normalize(kw)))
    if (matched.length > best.score) {
      best = { recipeId: r.id, score: matched.length, matched }
    }
  }
  return best
}
