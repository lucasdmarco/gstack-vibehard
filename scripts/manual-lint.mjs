#!/usr/bin/env node
// PRD51 S51.10.3 — lint dos manuais INTERNOS (§51.10 item 5 dos Manuais).
//
// NÃO é gate de release: `.docs/` é gitignored, então a CI não tem esses arquivos e
// ausência sai como `skipped`. Roda localmente, onde os manuais existem, para impedir que
// uma claim interna envelhecida (baseline defasada, comando inexistente) vire documentação
// pública enganosa depois. O manual guia o produto — nunca é empacotado com ele.
import { readFileSync, existsSync } from "fs"
import { INTERNAL_MANUALS, runManualLint } from "../src/meta/manual-lint.js"

const cliVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version

const manuals = INTERNAL_MANUALS.map((m) => ({
  ...m,
  text: existsSync(m.path) ? readFileSync(m.path, "utf-8") : null,
}))

const r = runManualLint({ manuals, cliVersion })

for (const m of r.perManual) {
  if (m.notApplicable) { console.log(`– ${m.path}: nada a verificar — ${m.reason}`); continue }
  if (m.skipped) { console.log(`– ${m.path}: pulado — ${m.reason}`); continue }
  if (m.unknown.length) console.log(`✗ ${m.path}: comando(s) inexistente(s): ${m.unknown.join(", ")}`)
  if (m.shellFences.length) console.log(`✗ ${m.path}: ${m.shellFences.length} fence(s) shell com PowerShell`)
  if (m.drift && m.drift.drifted) {
    const d = m.drift
    console.log(d.kind === "missing_baseline"
      ? `✗ ${m.path}: não declara baseline — impossível conferir contra qual versão o manual fala`
      : `✗ ${m.path}: baseline declarada v${d.declared}${d.declaredAt ? ` (${d.declaredAt})` : ""} != CLI v${d.actual}`)
  }
  // Só afirma o que de fato foi checado neste manual.
  if (m.ok) {
    const feitos = [m.checked.commands && "comandos existem", m.checked.baseline && `baseline == CLI v${cliVersion}`].filter(Boolean)
    console.log(`✓ ${m.path}: ${feitos.join("; ")}`)
  }
}

const sufixo = `${r.checked} verificado(s), ${r.skipped} ausente(s), ${r.notApplicable} sem check aplicável`
console.log(r.ok ? `manual-lint: OK (${sufixo}).` : `manual-lint: DIVERGÊNCIA (${sufixo}).`)

// Exit 1 só com manual PRESENTE e divergente — nunca por ausência.
process.exit(r.ok ? 0 : 1)
