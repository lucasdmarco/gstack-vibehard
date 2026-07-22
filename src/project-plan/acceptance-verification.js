/**
 * PRD47 S47.5 — QA, review e aceites executáveis: fecha a diferença entre
 * infraestrutura verde e produto funcionando. `pending_verifier` SÓ vira
 * `verifier` REAL quando existe engine comprovado (journey mapeada pra uma
 * jornada crítica) — nunca por decreto. Reusa `artifact-review.js`
 * (producer≠reviewer, LLM sempre advisory) e o gate `acceptanceResolved` do
 * `golden-run.js` (S47.1) sem duplicar nenhum dos dois.
 */
export const JOURNEY_METHODS = Object.freeze(["playwright", "api", "command", "schema"])
export const ACCEPTANCE_VERIFICATION_SCHEMA = "gstack.acceptance-verification.v1"

/** Mapeia UMA jornada crítica de aceite a um método verificável concreto e existente. */
export function mapJourney({ acceptanceId, method, ref, files = [] } = {}) {
  if (!JOURNEY_METHODS.includes(method)) throw new Error(`método de jornada desconhecido: ${method}`)
  if (!acceptanceId || !ref) throw new Error("mapJourney: acceptanceId e ref são obrigatórios")
  return { acceptanceId, method, ref, files: [...files] }
}

/**
 * Converte `pending_verifier` -> `verifier` REAL só quando existe journey
 * mapeada pra aquele aceite. SEM journey, o aceite continua pending — nunca
 * vira "funcional" por decreto (DoD: login/pagamento/painel não são
 * declarados funcionais por scaffold).
 */
export function resolvePendingVerifier(acceptance, journeys = []) {
  if (!acceptance.pending_verifier) return acceptance
  const journey = journeys.find((j) => j.acceptanceId === acceptance.id)
  if (!journey) return acceptance
  const { pending_verifier, ...rest } = acceptance
  return { ...rest, verifier: { kind: journey.method, ref: journey.ref, files: journey.files } }
}

/** Aplica `resolvePendingVerifier` a TODOS os aceites — engine real por engine real, nunca em lote por fé. */
export function resolveBriefAcceptances(acceptances = [], journeys = []) {
  return acceptances.map((a) => resolvePendingVerifier(a, journeys))
}

/**
 * Compliance determinístico: um aceite com verifier REAL só é `compliant` se o
 * diff tocou os arquivos relevantes (quando a journey os declara) E há um
 * resultado de teste correspondente que passou. Sem essa evidência, fica
 * `unverified` — nunca presumido ok (mesma disciplina de `dream metrics`/
 * `token estimate`: nada vira REAL sem prova).
 */
function isTouched(verifier, changedFiles) {
  const relevant = verifier.files
  return !relevant || relevant.length === 0 || relevant.some((f) => changedFiles.includes(f))
}
const testResultFor = (testResults, id) => (testResults ? testResults[id] : undefined)
function resultStatus(result) {
  if (result === false) return "failed"
  if (result === true) return "compliant"
  return null
}

export function checkCompliance({ acceptance, changedFiles = [], testResults = null } = {}) {
  if (acceptance.pending_verifier) return { id: acceptance.id, status: "pending" }
  if (!acceptance.verifier) return { id: acceptance.id, status: "unverified", reason: "sem verifier" }
  if (!isTouched(acceptance.verifier, changedFiles)) return { id: acceptance.id, status: "unverified", reason: "diff não tocou arquivos relevantes da journey" }
  const status = resultStatus(testResultFor(testResults, acceptance.id))
  if (status) return { id: acceptance.id, status }
  return { id: acceptance.id, status: "unverified", reason: "sem resultado de teste correspondente" }
}

/** Roda o compliance de TODOS os aceites — placar honesto, nunca "produto completo" sem prova em cada um. */
export function complianceReport({ acceptances = [], changedFiles = [], testResults = null } = {}) {
  const items = acceptances.map((a) => checkCompliance({ acceptance: a, changedFiles, testResults }))
  const allCompliant = items.length > 0 && items.every((i) => i.status === "compliant")
  return { schemaVersion: ACCEPTANCE_VERIFICATION_SCHEMA, items, allCompliant }
}
