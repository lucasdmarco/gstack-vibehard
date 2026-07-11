/**
 * Classificador determinístico (sem LLM): mapeia um objetivo textual para uma
 * recipe por contagem de keywords. Empate → ordem das RECIPES (estável).
 * Nenhuma keyword casada → recipe default (web-app), score 0.
 */
import { RECIPES, DEFAULT_RECIPE_ID } from "./recipes.js"
import { normalize, matchedKeywords } from "./keyword-match.js"

/**
 * @returns {{ recipeId, score, matched: string[] }}
 * Match por PALAVRA (36.5): "api" não casa mais "therapist", "app" não casa "apply".
 */
export function classify(objective) {
  const hay = normalize(objective)
  let best = { recipeId: DEFAULT_RECIPE_ID, score: 0, matched: [] }
  for (const r of RECIPES) {
    const matched = matchedKeywords(hay, r.intentKeywords)
    if (matched.length > best.score) {
      best = { recipeId: r.id, score: matched.length, matched }
    }
  }
  return best
}
