#!/usr/bin/env python3
"""Auto-save checkpoint for worktrees.

Called by stop.py at session end. Finds all worktrees in the project
and commits uncommitted changes as an auto-save checkpoint.

This prevents data loss if the user closes an Agent View worktree
(Ctrl+X) before pushing/merging.

Pattern: gstack-worktree-autosave
"""
import json, os, subprocess, sys
from pathlib import Path


def find_worktrees(root: Path) -> list[Path]:
    """Find worktree dirs by scanning .git/worktrees/ or calling git worktree list."""
    git_dir = root / ".git"
    worktrees = []

    # Method 1: .git/worktrees/ directory
    wt_dir = git_dir / "worktrees"
    if wt_dir.exists():
        for entry in wt_dir.iterdir():
            gitdir_file = entry / "gitdir"
            if gitdir_file.exists():
                try:
                    wt_path = gitdir_file.read_text(encoding="utf-8").strip()
                    if wt_path:
                        worktrees.append(Path(wt_path).parent)
                except OSError:
                    pass

    # Method 2: git worktree list
    if not worktrees:
        try:
            result = subprocess.run(
                ["git", "worktree", "list", "--porcelain"],
                capture_output=True, text=True, timeout=15, cwd=str(root)
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if line.startswith("worktree "):
                        wt_path = line[len("worktree "):].strip()
                        p = Path(wt_path)
                        if p != root:
                            worktrees.append(p)
        except (OSError, subprocess.TimeoutExpired):
            pass

    return worktrees


def autosave_worktree(wt_path: Path) -> dict:
    """Commit any uncommitted changes in the worktree as an auto-save checkpoint.

    Returns dict with status and commit info.
    """
    if not wt_path.exists():
        return {"path": str(wt_path), "status": "skipped", "reason": "path not found"}

    try:
        # Check for changes
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=15, cwd=str(wt_path)
        )
        if status.returncode != 0 or not status.stdout.strip():
            return {"path": str(wt_path), "status": "clean", "reason": "no changes"}

        # Stage all
        subprocess.run(
            ["git", "add", "-A"],
            capture_output=True, text=True, timeout=30, cwd=str(wt_path)
        )

        # Commit
        commit = subprocess.run(
            ["git", "commit", "-m", "gstack auto-save agent checkpoint",
             "--allow-empty", "--no-verify"],
            capture_output=True, text=True, timeout=30, cwd=str(wt_path)
        )

        if commit.returncode == 0:
            sha = commit.stdout.splitlines()[-1] if commit.stdout else "unknown"
            return {"path": str(wt_path), "status": "committed", "sha": sha}
        return {"path": str(wt_path), "status": "failed", "reason": commit.stderr[:200]}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"path": str(wt_path), "status": "error", "reason": str(e)}


def autosave_all_worktrees(cwd: str) -> list[dict]:
    """Find and auto-save all worktrees reachable from cwd."""
    if not cwd:
        return [{"status": "skipped", "reason": "cwd missing"}]

    root = Path(cwd).resolve()
    for _ in range(5):
        if (root / ".git").exists():
            break
        root = root.parent
    else:
        return [{"status": "skipped", "reason": "no .git found"}]

    worktrees = find_worktrees(root)
    results = []
    for wt in worktrees:
        result = autosave_worktree(wt)
        results.append(result)

    # Always also autosave the main repo
    main_result = autosave_worktree(root)
    results.append(main_result)

    return results


def main():
    cwd = os.environ.get("GSTACK_CWD", "")
    results = autosave_all_worktrees(cwd)
    committed = [r for r in results if r.get("status") == "committed"]
    if committed:
        sys.stderr.write(f"[worktree-autosave] salvou {len(committed)} worktree(s)\n")
        for r in committed:
            sys.stderr.write(f"  {r['path']}: {r.get('sha', '?')[:12]}\n")


if __name__ == "__main__":
    main()
