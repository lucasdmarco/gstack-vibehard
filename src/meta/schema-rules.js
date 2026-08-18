/**
 * Validação por TABELA DE REGRAS — o idioma que este repositório já usa.
 *
 * `BLOCKER_RULES` do `node-health`, `HOOK_RULES` do inventário e `JS_RULES` do
 * engine de AST são todos a mesma forma: uma lista de `{ when, problem }` e um
 * runner genérico. A alternativa — encadear `if`s — cresce em complexidade
 * ciclomática a cada regra e esconde a lista do leitor, que passa a ter de
 * reconstruí-la de cabeça.
 *
 * A regra devolve TODOS os problemas, nunca o primeiro: quem escreve o registro
 * precisa saber tudo o que falta de uma vez, e parar no primeiro erro
 * transformaria a correção numa sequência de tentativas.
 */

export const SCHEMA_RULES_VERSION = "gstack.schema-rules.v1"

/** Aplica a tabela e devolve os problemas acusados. */
export function problemas(valor, regras) {
  return regras.filter((r) => r.when(valor)).map((r) => r.problem(valor))
}

/** Regra pronta: campo obrigatório ausente. */
export const camposObrigatorios = (campos) => campos.map((f) => ({
  when: (v) => !(f in v),
  problem: () => `campo ausente: ${f}`,
}))

/** Regra pronta: valor fora de um vocabulário fechado. */
export const doVocabulario = (campo, vocabulario) => ({
  when: (v) => v[campo] !== undefined && !vocabulario.includes(v[campo]),
  problem: (v) => `${campo} fora do vocabulário: ${JSON.stringify(v[campo])}`,
})

/** Guarda comum a todo validador: o que não é objeto não tem campos. */
export const naoEhObjeto = (v) => !v || typeof v !== "object"
