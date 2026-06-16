import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = path.resolve(import.meta.dirname, "..")
const depsModule = path.join(repoRoot, "src", "installer", "deps.js")

test("findWorkingBinary retorna o primeiro candidato que responde", async () => {
  const { findWorkingBinary } = await import(`${pathToFileURL(depsModule)}?t=${Date.now()}`)
  const tried = []
  const exec = (bin) => {
    tried.push(bin)
    if (bin === "/real/uv") return Buffer.from("uv 0.1")
    throw new Error("not found")
  }
  const result = findWorkingBinary(["/fake/uv", "/real/uv", "uv"], { exec })
  assert.equal(result, "/real/uv")
  // Para no primeiro sucesso — nao testa "uv"
  assert.deepEqual(tried, ["/fake/uv", "/real/uv"])
})

test("findWorkingBinary retorna '' quando nenhum responde", async () => {
  const { findWorkingBinary } = await import(`${pathToFileURL(depsModule)}?t=${Date.now()}`)
  const exec = () => { throw new Error("not found") }
  assert.equal(findWorkingBinary(["a", "b"], { exec }), "")
})

test("findWorkingBinary ignora candidatos vazios", async () => {
  const { findWorkingBinary } = await import(`${pathToFileURL(depsModule)}?t=${Date.now()}`)
  const tried = []
  const exec = (bin) => { tried.push(bin); return Buffer.from("ok") }
  const result = findWorkingBinary(["", null, "uv"], { exec })
  assert.equal(result, "uv")
  assert.deepEqual(tried, ["uv"])
})

test("getUvCandidates e getBunCandidates incluem PATH e caminhos por OS", async () => {
  const { getUvCandidates, getBunCandidates } = await import(`${pathToFileURL(depsModule)}?t=${Date.now()}`)
  const uvWin = getUvCandidates("C:\\Users\\x", true)
  assert.ok(uvWin.some((c) => c.endsWith("uv.exe")))
  assert.equal(uvWin[uvWin.length - 1], "uv", "termina com o nome no PATH")

  const bunNix = getBunCandidates("/home/x", false)
  assert.ok(bunNix.some((c) => c.includes(".bun")))
  assert.equal(bunNix[bunNix.length - 1], "bun")
})

test("isBinaryAvailable reflete sucesso/falha do exec", async () => {
  const { isBinaryAvailable } = await import(`${pathToFileURL(depsModule)}?t=${Date.now()}`)
  assert.equal(isBinaryAvailable("node", { exec: () => Buffer.from("ok") }), true)
  assert.equal(isBinaryAvailable("nope", { exec: () => { throw new Error("x") } }), false)
})

test("npxArgv: Windows usa cmd.exe /c npx; unix usa npx direto", async () => {
  const { npxArgv } = await import(`${pathToFileURL(depsModule)}?t=${Date.now()}`)
  assert.deepEqual(npxArgv(["playwright", "--version"], "win32"), {
    file: "cmd.exe", argv: ["/c", "npx", "playwright", "--version"],
  })
  assert.deepEqual(npxArgv(["playwright", "--version"], "linux"), {
    file: "npx", argv: ["playwright", "--version"],
  })
})
