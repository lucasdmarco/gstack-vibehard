#!/usr/bin/env node
// Postinstall CROSS-PLATFORM: roda `fallow coverage setup` SE o fallow existir,
// mas NUNCA falha o install. O antigo `... || true` é sintaxe de shell Unix — no
// cmd.exe do Windows o `true` não existe, então o postinstall saía com erro e
// quebrava o `pnpm install`. Aqui sempre saímos com exit 0.
import { spawnSync } from "node:child_process"

const isWin = process.platform === "win32"

function hasFallow() {
  try {
    return spawnSync(isWin ? "where" : "which", ["fallow"], { stdio: "ignore" }).status === 0
  } catch {
    return false
  }
}

try {
  if (hasFallow()) {
    spawnSync("fallow", ["coverage", "setup", "--yes", "--json"], { stdio: "ignore", shell: isWin })
  }
} catch {
  /* opcional — nunca falha o install do projeto */
}
process.exit(0)
