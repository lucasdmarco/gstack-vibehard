#!/usr/bin/env python3
"""GStack Quality Gate wrapper around Fallow.

This script intentionally does not use an LLM. It delegates static analysis to
Fallow through the stable CLI contract requested by the architecture:

    npx fallow audit --format json

The JSON returned to the agent is normalized and limited to auto-fixable
findings so agents spend context only on issues they can act on.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


FALLOW_COMMAND = ["npx", "fallow", "audit", "--format", "json"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run deterministic Fallow Quality Gate")
    parser.add_argument("--path", required=True, help="Project path to audit")
    parser.add_argument("--level", type=int, choices=[1, 2, 3], default=1, help="Compatibility flag for existing hooks")
    parser.add_argument("--log-only", action="store_true", help="Emit report but do not fail process")
    parser.add_argument("--timeout", type=int, default=120, help="Fallow timeout in seconds")
    return parser.parse_args()


def emit(result: dict[str, Any], exit_code: int) -> None:
    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(exit_code)


def error_result(message: str, *, level: int, command: list[str], detail: str | None = None) -> dict[str, Any]:
    issue = {
        "rule": "qg-runtime",
        "title": message,
        "severity": "CRITICO",
        "auto_fixable": False,
    }
    if detail:
        issue["detail"] = detail
    return {
        "pass": False,
        "engine": "fallow",
        "level": level,
        "command": command,
        "verdict": "fail",
        "issues": [issue],
        "auto_fixable": [],
        "summary": f"Fallow Quality Gate failed: {message}",
    }


def extract_json(stdout: str) -> Any:
    text = stdout.strip()
    if not text:
        raise ValueError("Fallow returned empty stdout")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        for index, char in enumerate(text):
            if char not in "[{":
                continue
            try:
                parsed, _ = decoder.raw_decode(text[index:])
                return parsed
            except json.JSONDecodeError:
                continue
        raise


def iter_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_dicts(child)


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1"}
    return bool(value)


def infer_verdict(raw: Any, returncode: int) -> str:
    if isinstance(raw, dict):
        for key in ["verdict", "status", "result"]:
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                lowered = value.strip().lower()
                if lowered in {"pass", "passed", "ok", "success"}:
                    return "pass"
                if lowered in {"fail", "failed", "error", "blocked"}:
                    return "fail"
        if raw.get("pass") is False or raw.get("passed") is False:
            return "fail"
        if raw.get("pass") is True or raw.get("passed") is True:
            return "pass"
    return "fail" if returncode != 0 else "pass"


def _synthesize_title(item: dict[str, Any]) -> str:
    """Titulo legivel para findings sem title (ex.: metricas CRAP de complexidade)."""
    if "crap" in item or "cyclomatic" in item:
        name = item.get("name") or item.get("path") or "?"
        cyc = item.get("cyclomatic")
        cog = item.get("cognitive")
        return f"Complexidade CRAP: {name} (cyclomatic {cyc}, cognitive {cog})"
    return "Fallow finding"


def normalize_issue(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "rule": item.get("rule") or item.get("code") or item.get("id") or item.get("name") or "fallow",
        "title": item.get("title") or item.get("message") or item.get("description") or _synthesize_title(item),
        "file": item.get("file") or item.get("path") or item.get("filename") or item.get("location", {}).get("file"),
        "line": item.get("line") or item.get("startLine") or item.get("location", {}).get("line"),
        "severity": str(item.get("severity") or item.get("level") or "MEDIO").upper(),
        "category": item.get("category") or item.get("kind") or item.get("type"),
        "metric": item.get("metric") or item.get("metric_name"),
        "auto_fixable": True,
        "fix": item.get("fix") or item.get("suggestion") or item.get("autofix") or item.get("auto_fix"),
        "raw": item,
    }


def collect_auto_fixable(raw: Any) -> list[dict[str, Any]]:
    issues = []
    seen = set()
    for item in iter_dicts(raw):
        if not truthy(item.get("auto_fixable")):
            continue
        normalized = normalize_issue(item)
        fingerprint = json.dumps(
            [normalized.get("rule"), normalized.get("file"), normalized.get("line"), normalized.get("title")],
            sort_keys=True,
            ensure_ascii=False,
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        issues.append(normalized)
    return issues


def collect_blocking(raw: Any) -> list[dict[str, Any]]:
    """Non-auto-fixable findings — o agente nao pode corrigi-los sozinho, mas
    precisa saber que existem para explicar um verdict 'fail' (senao recebe
    pass=False com issues=[] e nenhuma pista)."""
    issues = []
    seen = set()
    for item in iter_dicts(raw):
        if truthy(item.get("auto_fixable")):
            continue
        # Heuristica conservadora: so dicts que parecem findings
        looks_like_issue = "severity" in item or ("rule" in item and ("title" in item or "message" in item))
        if not looks_like_issue:
            continue
        normalized = normalize_issue(item)
        normalized["auto_fixable"] = False
        fingerprint = json.dumps(
            [normalized.get("rule"), normalized.get("file"), normalized.get("line"), normalized.get("title")],
            sort_keys=True,
            ensure_ascii=False,
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        issues.append(normalized)
    return issues


def skipped_result(reason: str, level: int) -> dict[str, Any]:
    """Resultado nao-bloqueante quando o Fallow esta indisponivel.

    Fallow e uma dependencia OPCIONAL (peerDependenciesMeta). Sua ausencia nao e
    uma falha de qualidade do codigo — bloquear a entrega nesse caso seria um
    falso positivo. O QG pula e passa, deixando claro como ativar.
    """
    return {
        "pass": True,
        "engine": "fallow",
        "level": level,
        "command": FALLOW_COMMAND,
        "verdict": "skipped",
        "issues": [],
        "auto_fixable": [],
        "blocking": [],
        "summary": f"Fallow indisponivel — QG pulado ({reason}). Instale: npm i -g fallow",
    }


def run_fallow(root: Path, timeout: int) -> tuple[Any, subprocess.CompletedProcess[str] | None]:
    npx = shutil.which("npx")
    if npx is None:
        return None, None
    completed = subprocess.run(
        [npx, *FALLOW_COMMAND[1:]],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    # Fallow ausente/quebrado costuma sair !=0 com stdout vazio — nao bloquear
    if not (completed.stdout or "").strip():
        return None, completed
    raw = extract_json(completed.stdout)
    return raw, completed


def run_typecheck(root: Path) -> dict:
    """Optional: run tsc --noEmit to catch TypeScript type errors (P2 blind spot).

    Returns dict with status and summary. Non-blocking — Fallow is the primary gate.
    """
    npx = shutil.which("npx")
    if npx is None:
        return {"status": "skipped", "summary": "npx not found"}
    tsconfig = root / "tsconfig.json"
    if not tsconfig.exists():
        return {"status": "skipped", "summary": "no tsconfig.json"}
    try:
        result = subprocess.run(
            [npx, "tsc", "--noEmit"],
            cwd=root, capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            return {"status": "passed", "summary": "TypeScript: no type errors"}
        errors = len([l for l in result.stdout.splitlines() if "error" in l.lower() or "TS" in l])
        return {
            "status": "failed",
            "summary": f"TypeScript: {errors} type error(s)",
            "errors": errors,
            "stdout": result.stdout[-2000:],
            "stderr": result.stderr[-2000:],
        }
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"status": "skipped", "summary": f"tsc failed: {e}"}


def main() -> None:
    args = parse_args()
    root = Path(args.path).resolve()
    if not root.exists():
        result = error_result(f"Path not found: {root}", level=args.level, command=FALLOW_COMMAND)
        emit(result, 0 if args.log_only else 1)

    try:
        raw, completed = run_fallow(root, args.timeout)
    except subprocess.TimeoutExpired as exc:
        result = error_result(f"Fallow timed out after {args.timeout}s", level=args.level, command=FALLOW_COMMAND, detail=str(exc))
        emit(result, 0 if args.log_only else 1)
    except (json.JSONDecodeError, ValueError) as exc:
        result = error_result("Fallow returned invalid JSON", level=args.level, command=FALLOW_COMMAND, detail=str(exc))
        emit(result, 0 if args.log_only else 1)
    except OSError as exc:
        result = error_result("Fallow execution failed", level=args.level, command=FALLOW_COMMAND, detail=str(exc))
        emit(result, 0 if args.log_only else 1)

    # Fallow indisponivel (npx ausente ou stdout vazio) — pula sem bloquear
    if raw is None:
        result = skipped_result("npx/fallow ausente ou sem saida", args.level)
        typecheck = run_typecheck(root)
        if typecheck.get("status") == "failed":
            result["typecheck"] = typecheck
            result["summary"] += f" | {typecheck['summary']}"
        emit(result, 0)

    verdict = infer_verdict(raw, completed.returncode)
    auto_fixable = collect_auto_fixable(raw)
    blocking = collect_blocking(raw)
    passed = verdict == "pass"
    summary = f"Fallow Quality Gate: {verdict.upper()} ({len(auto_fixable)} auto-fixable, {len(blocking)} blocking issue(s))"
    result = {
        "pass": passed,
        "engine": "fallow",
        "level": args.level,
        "command": FALLOW_COMMAND,
        "verdict": verdict,
        "returncode": completed.returncode,
        "issues": auto_fixable,
        "auto_fixable": auto_fixable,
        "blocking": blocking,
        "summary": summary,
    }

    # Optional TypeScript type check (non-blocking, covers P2 blind spot)
    typecheck = run_typecheck(root)
    if typecheck.get("status") == "failed":
        result["typecheck"] = typecheck
        result["summary"] += f" | {typecheck['summary']}"
        sys.stderr.write(f"[qg] TypeScript: {typecheck['summary']}\n")

    emit(result, 0 if passed or args.log_only else 1)


if __name__ == "__main__":
    main()
