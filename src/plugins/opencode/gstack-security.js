const BLOCK_PATTERNS = [
  { pattern: /\brm\s+-rf\s+[/\\](\s|$)/i, reason: "rm -rf / bloqueado (destruiria o sistema)" },
  { pattern: /\brm\s+-rf\s+~[/\\]/i, reason: "rm -rf na home bloqueado" },
  { pattern: /\brm\s+-rf\s+\$HOME[/\\]/i, reason: "rm -rf na home bloqueado" },
  { pattern: /\brm\s+-rf\s+--no-preserve-root\b/i, reason: "rm --no-preserve-root bloqueado" },
  { pattern: /\bchmod\s+-R\s+777\s+[/\\]/i, reason: "chmod 777 / bloqueado" },
  { pattern: /\bdangerously-bypass-hook-trust\b/i, reason: "bypass de hooks bloqueado" },
  { pattern: /\bwget\s+.+--no-check-certificate\b/i, reason: "wget sem certificado bloqueado" },
  { pattern: /\bcurl\s+.+-k\s/i, reason: "curl sem certificado bloqueado" },
  { pattern: /[|;]\s*(sh|bash|zsh)\s+-c\s+["'](?:curl|wget)/i, reason: "pipe para shell remoto bloqueado" },
]

const SAFE_PATTERNS = [
  /^npm (run|test|build|dev|start|lint|typecheck)\b/,
  /^npx\s+tsx\b/,
  /^npx\s+vitest\b/,
  /^npx\s+playwright\b/,
  /^npm install\b/,
  /^git (status|diff|log|branch|add|commit|push|pull|checkout\s+-b)\b/,
  /^dir\b/,
  /^ls\b/,
  /^Get-ChildItem\b/,
  /^cat\b/,
  /^type\b/,
  /^echo\b/,
  /^pwd\b/,
  /^node\s/,
  /^python3?\s/,
  /^dx\s/,
]

export const GstackSecurity = async () => {
  if (process.env.GSTACK_OPENCODE_DISABLE === "1") return {} // kill switch (P0.4)
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const cmd = input.args?.command || ""
      if (!cmd) return

      for (const { pattern, reason } of BLOCK_PATTERNS) {
        if (pattern.test(cmd)) {
          throw new Error(reason)
        }
      }

      for (const pattern of SAFE_PATTERNS) {
        if (pattern.test(cmd.trim())) {
          return
        }
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "bash" && input.tool !== "edit" && input.tool !== "write") return

      const responseStr = JSON.stringify(output).toLowerCase()
      if (responseStr.includes("error") || responseStr.includes("fail") || responseStr.includes("not found")) {
        output._gstack_review = "⚠️ Possivel erro detectado no resultado do tool call. Revise antes de continuar."
      }
    },
  }
}
