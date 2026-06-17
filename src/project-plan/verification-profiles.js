/**
 * Perfis de verificação por tipo de loop (PRD kilo-loop-patterns §5).
 * Cada perfil aponta comandos REAIS; sinais de browser/preview são OPCIONAIS
 * (o runtime/preview ainda não existe — ver pending-features).
 *
 * Módulo PURO: só descreve como verificar; não executa nada.
 */

export const VERIFICATION_PROFILES = Object.freeze({
  "test-driven": {
    id: "test-driven",
    requiredSignals: ["target test passes", "suite passes"],
    optionalSignals: ["coverage stable"],
    preferredCommands: ["npm test", "pytest -q"],
    fallbackCommands: ["npm run test:py", "cargo test", "go test ./..."],
    successCriteria: ["teste alvo verde", "suite ampla verde", "QG sem blocker"],
  },
  "compiler-driven": {
    id: "compiler-driven",
    requiredSignals: ["typecheck passes", "build passes or documented unavailable"],
    optionalSignals: ["lint clean"],
    preferredCommands: ["npm run typecheck", "npm run build"],
    fallbackCommands: ["npx tsc --noEmit", "npm test"],
    successCriteria: ["typecheck/build passa", "QG sem blocker"],
  },
  "review-driven": {
    id: "review-driven",
    requiredSignals: ["actionable comments addressed", "relevant tests pass"],
    optionalSignals: ["diff reviewed"],
    preferredCommands: ["npm test"],
    fallbackCommands: ["pytest -q", "git diff --stat"],
    successCriteria: ["comentários acionáveis aplicados", "não-acionáveis registrados", "QG sem blocker"],
  },
  "runtime-debugging": {
    id: "runtime-debugging",
    requiredSignals: ["error reproduced then fixed"],
    optionalSignals: ["logs captured", "repro command documented"],
    preferredCommands: ["npm test"],
    fallbackCommands: ["pytest -q"],
    successCriteria: ["erro reproduzido e corrigido ou handoff", "teste alvo verde quando possível", "QG sem blocker"],
  },
  "product-iteration": {
    id: "product-iteration",
    requiredSignals: ["reviewable diff", "acceptance criteria met"],
    // preview/browser/screenshot ficam OPCIONAIS — dependem de runtime futuro.
    optionalSignals: ["preview ok", "screenshot captured", "basic a11y checked", "responsive checked"],
    preferredCommands: ["npm test"],
    fallbackCommands: ["git diff --stat"],
    successCriteria: ["diff revisável", "acessibilidade básica quando aplicável", "QG sem blocker"],
  },
})

export function getVerificationProfile(id) {
  return VERIFICATION_PROFILES[id] || null
}
