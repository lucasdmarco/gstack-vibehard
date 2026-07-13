"""Helper de teste (PRD41 S41.2): escreve o marcador canônico
`.gstack/project.json` para ATIVAR um projeto gstack de teste. Após o P0.3, a mera
existência de `.gstack/` não ativa mais — precisa do marcador válido."""
import json
import uuid
from pathlib import Path


def mark_project(root, mode="lite"):
    """Cria `.gstack/` + `project.json` válido em `root` (canônico). Retorna o Path
    do `.gstack`. Substitui o antigo `(root / '.gstack').mkdir()` dos testes."""
    root = Path(root).resolve()
    gdir = root / ".gstack"
    gdir.mkdir(parents=True, exist_ok=True)
    (gdir / "project.json").write_text(
        json.dumps({
            "schemaVersion": "gstack.project.v1",
            "projectId": str(uuid.uuid4()),
            "root": str(root),
            "mode": mode,
            "activated": True,
            "createdBy": "test",
        }),
        encoding="utf-8",
    )
    return gdir
