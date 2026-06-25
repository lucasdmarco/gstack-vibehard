import net from "net"

/**
 * Alocação de porta sem race (PRD 12 PR4): tenta a `preferred`; se ocupada, acha a
 * próxima livre FAZENDO O BIND real (não só um scan), e o supervisor passa a porta
 * escolhida via env — fecha o gap "scan-depois-start". `isFree`/`createServer`
 * injetáveis para teste (sem tocar a rede real).
 */
export function isPortFree(port, opts = {}) {
  const createServer = opts.createServer || (() => net.createServer())
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const srv = createServer()
    srv.once("error", () => finish(false))
    srv.once("listening", () => srv.close(() => finish(true)))
    try { srv.listen(port, "127.0.0.1") } catch { finish(false) }
  })
}

export async function allocatePort(preferred, opts = {}) {
  const isFree = opts.isFree || ((p) => isPortFree(p, opts))
  const maxTries = opts.maxTries || 64
  let p = Number(preferred) || 3000
  for (let i = 0; i < maxTries; i++) {
    if (await isFree(p)) return p
    p++
  }
  throw new Error(`nenhuma porta livre a partir de ${preferred} (tentei ${maxTries})`)
}
