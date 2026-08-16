/**
 * Vocabulário de audiências — módulo próprio para quebrar o CICLO.
 *
 * `i18n-inventory.js` importa o loader do registry (Fatia 3), e o loader precisa
 * validar a audiência declarada em cada entrada. Importá-la de volta do
 * inventário fecharia um ciclo ESM: funciona por acidente de ordem de avaliação
 * e quebra em silêncio quando alguém reordena um import.
 *
 * A mudança de casa NÃO foi neutra: a revisão da Fatia 3 achou que o engine AST
 * emitia duas audiências (`public_interactive`, `render_primitive`) ausentes
 * desta lista. Cada componente estava correto isoladamente e o contrato entre
 * eles estava quebrado — na Fatia 5, o loader recusaria como `corrupt` o
 * registry legítimo do primeiro arquivo convertido. As duas foram acrescentadas
 * aqui, e há teste de contrato cruzando gerador × vocabulário para que o drift
 * não volte despercebido.
 */

/** Audiências possíveis. `unknown` bloqueia; ausência de classificação não existe. */
export const AUDIENCES = Object.freeze([
  "public_diagnostic",       // aparece normalmente ou após falha — entra, deve ser inglês
  "public_security_decision", // bloqueio/approval/alerta — entra, deve ser inglês
  // `machine_protocol` EXIGE consumidor/parser real, contrato e teste. Sem os três, a
  // categoria vira depósito de "casos sem idioma" e some com o problema em vez de
  // resolvê-lo — por isso duas classes foram extraídas dela:
  "machine_protocol",        // contrato consumido por parser real — inglês estável
  "terminal_control",        // byte de controle do terminal (BEL, ANSI) — não há idioma
  "test_observability",      // marcador consumido por teste, sob ativação explícita
  "internal_debug",          // diagnóstico interno explicitamente ativado — fora da claim
  // As duas abaixo são emitidas pelo engine AST (regras `interactive-prompt` e
  // `render-primitive-impl`) e faltavam aqui. Sem elas, o loader classificaria
  // como `corrupt` o registry LEGÍTIMO do primeiro arquivo convertido — dois
  // componentes corretos isoladamente, contrato quebrado entre eles.
  "public_interactive",      // pergunta que o usuário lê e responde — entra, inglês
  "render_primitive",        // o texto vem de OUTRO lugar, que já foi contado: contar
                             // aqui duplicaria a mesma mensagem no inventário. DUAS
                             // formas, mesmo critério — console.* dentro da primitiva
                             // que implementa o canal (a função só decora, o texto é do
                             // chamador); e repasse cru da saída de um artefato do
                             // próprio pacote cujas frases já têm ponto próprio, onde a
                             // fronteira atravessada é de PROCESSO e não de função. A
                             // segunda só vale enquanto a origem estiver mesmo no censo
                             // — ver `stream-counted-subprocess-origin`.
  "external_passthrough",    // bytes de subprocesso externo, encaminhados sem transformação
  "generated_app_copy",      // texto do app do usuário — segue o idioma do projeto
  "generated_dev_surface",   // mensagem técnica no projeto gerado — entra, inglês
  "user_content",            // conteúdo do usuário — nunca traduzir
  "unknown",                 // audiência indeterminada — BLOQUEIA a Fase 1
])

/**
 * Quem entra na claim English-first.
 *
 * `public_interactive` ENTRA: é texto que o usuário lê para responder.
 * `render_primitive` NÃO entra: não é unidade traduzível — a string vem do
 * chamador, que já foi contado. Incluí-la duplicaria a mesma mensagem.
 */
const IN_SCOPE_AUDIENCES = new Set([
  "public_diagnostic", "public_security_decision", "generated_dev_surface", "public_interactive",
])

export const isInScope = (audience) => IN_SCOPE_AUDIENCES.has(audience)

/**
 * Audiências que uma decisão HUMANA pode declarar num override.
 *
 * `unknown` fica de fora: é estado de investigação, não destino. Um override
 * para `unknown` gastaria a cerimônia toda (reason, owner, evidence,
 * expectedFileHash) para não resolver classificação nenhuma — e ainda daria
 * aparência de decisão tomada.
 */
export const OVERRIDABLE_AUDIENCES = Object.freeze(AUDIENCES.filter((a) => a !== "unknown"))
