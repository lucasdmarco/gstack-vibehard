#!/usr/bin/env python3
"""Chat Import Pipeline: claude_to_obsidian.py

Lê logs brutos de sessões (chronicle .md) ou JSONL de entrada,
extrai keywords via BM25 leve, gera frontmatter YAML com tags automáticas,
converte menções a arquivos/classes/decisões em [[wikilinks]] Obsidian,
e salva em ~/gstack-vault/chats/.

Uso:
  python claude_to_obsidian.py                          # varre ~/.codex/chronicle/
  python claude_to_obsidian.py --input <caminho>        # arquivo ou diretório único
  python claude_to_obsidian.py --stdin                  # lê JSONL do stdin (pipe)

Zero-Config: detecta ~/gstack-vault automaticamente.
Cria o diretório chats/ se não existir.
"""

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# ── Config ──
VAULT_DIR = Path.home() / "gstack-vault"
CHATS_DIR = VAULT_DIR / "chats"
CHRONICLE_DIR = Path.home() / ".codex" / "chronicle"

# Stopwords PT+EN para BM25 leve
STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an",
    "and", "any", "are", "aren", "as", "at", "be", "because", "been",
    "before", "being", "below", "between", "both", "but", "by", "can",
    "cannot", "com", "could", "couldn", "d", "de", "did", "didn", "do",
    "does", "doesn", "doing", "don", "down", "during", "each", "few",
    "for", "from", "further", "had", "hadn", "has", "hasn", "have",
    "haven", "having", "he", "her", "here", "hers", "herself", "him",
    "himself", "his", "how", "i", "if", "in", "into", "is", "isn",
    "it", "its", "itself", "just", "ll", "m", "ma", "me", "might",
    "mightn", "more", "most", "mustn", "my", "myself", "needn", "no",
    "nor", "not", "now", "o", "of", "off", "on", "once", "only", "or",
    "other", "our", "ours", "ourselves", "out", "over", "own", "para",
    "per", "que", "re", "s", "same", "shan", "she", "should", "shouldn",
    "so", "some", "such", "t", "than", "that", "the", "their", "theirs",
    "them", "themselves", "then", "there", "these", "they", "this",
    "those", "through", "to", "too", "under", "until", "up", "um",
    "very", "was", "wasn", "we", "were", "weren", "what", "when",
    "where", "which", "while", "who", "whom", "why", "will", "with",
    "won", "would", "wouldn", "y", "you", "your", "yours", "yourself",
    "yourselves", "é", "como", "mais", "mas", "por", "se", "até",
}


def tokenize(text: str) -> List[str]:
    """Lowercase + split on non-alpha + stopword removal."""
    tokens = re.findall(r"[a-záéíóúãõâêîôûçàèìòùäëïöüñ]+", text.lower())
    return [t for t in tokens if len(t) > 2 and t not in STOPWORDS]


def bm25_keywords(text: str, top_n: int = 10) -> List[str]:
    """BM25-light keyword extraction.

    Trata o texto como documento único e usa term frequency
    com length normalization simples (okapi BM25-inspired).
    """
    tokens = tokenize(text)
    if not tokens:
        return []
    total_terms = len(tokens)
    if total_terms < 5:
        return list(dict.fromkeys(tokens))[:top_n]

    tf = Counter(tokens)
    avgdl = max(total_terms, 1)
    k1, b = 1.5, 0.75

    scores = {}
    for term, freq in tf.items():
        idf = math.log(1 + (1000 - freq + 0.5) / (freq + 0.5))
        numer = freq * (k1 + 1)
        denom = freq + k1 * (1 - b + b * (total_terms / avgdl))
        scores[term] = idf * (numer / denom)

    return [t for t, _ in sorted(scores.items(), key=lambda x: -x[1])][:top_n]


def extract_wikilinks(text: str) -> List[str]:
    """Detecta menções a arquivos, classes ou decisões que viram [[wikilinks]].

    Padrões:
      - Caminhos de arquivo (.py, .ts, .js, .rs, .go, .md, .json, .yaml)
      - Nomes de classe/função (CamelCase, snake_case com parênteses)
      - Referências a decisões (DECISION:, Decision:, decisão:)
    """
    links = set()

    # File paths (.py, .ts, .js, .rs, .go, .md, .json, .yaml)
    for m in re.finditer(r'(?:src|apps|packages|hooks|scripts|templates)/(?:[\w/-]+\.(?:py|ts|js|rs|go|md|json|yaml|tsx|jsx))', text):
        links.add(m.group(0))

    # Class names (CamelCase after class/interface/enum)
    for m in re.finditer(r'\b(?:class|interface|enum|struct|trait)\s+([A-Z][a-zA-Z0-9]+)', text):
        links.add(m.group(1))

    # Function/method calls: snake_case followed by (
    for m in re.finditer(r'\b([a-z][a-z0-9_]+)\s*\(', text):
        name = m.group(1)
        if name not in ("if", "for", "while", "with", "def", "function", "var", "let", "const", "return", "import", "export", "print", "exec", "run", "get", "set", "has", "is", "not", "and", "or"):
            links.add(f"{name}()")

    # Decision references
    for m in re.finditer(r'(?:DECISION|Decision|Decisão|decisão)[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-_]{3,60})', text):
        links.add(f"DECISION: {m.group(1).strip()[:50]}")

    return sorted(links)[:25]  # max 25 wikilinks per note


def generate_tags(keywords: List[str], wikilinks: List[str], text: str) -> List[str]:
    """Gera tags automáticas a partir de keywords + wikilinks + contexto."""
    tags = set()

    # Tags from keywords (first 5)
    for kw in keywords[:5]:
        tags.add(kw.lower().replace(" ", "-"))

    # Contextual tags
    text_lower = text.lower()
    if "security gate" in text_lower or "security_gate" in text_lower:
        tags.add("security-gate")
    if "deploy" in text_lower:
        tags.add("deploy")
    if "bug" in text_lower or "fix" in text_lower or "error" in text_lower:
        tags.add("bugfix")
    if "feature" in text_lower or "feat" in text_lower:
        tags.add("feature")
    if "refactor" in text_lower:
        tags.add("refactor")
    if "agent" in text_lower or "harness" in text_lower:
        tags.add("agent")
    if "fallow" in text_lower:
        tags.add("fallow")
    if "mom" in text_lower:
        tags.add("mom")

    # Project scope
    for link in wikilinks:
        parts = link.split("/")
        if len(parts) >= 2:
            scope = parts[0]
            if scope in ("src", "apps", "packages", "hooks", "scripts", "templates"):
                tags.add(scope)

    return sorted(tags)[:15]


def build_frontmatter(title: str, keywords: List[str], wikilinks: List[str],
                      tags: List[str], source: str) -> str:
    """Gera cabeçalho YAML frontmatter para Obsidian."""
    lines = ["---"]
    lines.append(f'title: "{title}"')
    lines.append(f"created_at: {datetime.now().isoformat()}")
    if tags:
        lines.append(f"tags: [{', '.join(tags)}]")
    if keywords:
        lines.append(f"keywords: [{', '.join(kw.lower() for kw in keywords)}]")
    lines.append(f"source: {source}")
    if wikilinks:
        lines.append("wikilinks:")
        for wl in wikilinks:
            lines.append(f"  - \"{wl}\"")
    lines.append("---")
    return "\n".join(lines)


def convert_to_wikilinks(text: str) -> str:
    """Transforma menções detectadas em [[wikilinks]] no corpo do texto."""
    # File paths
    text = re.sub(
        r'(?<!\[\[)((?:src|apps|packages|hooks|scripts|templates)/(?:[\w/-]+\.(?:py|ts|js|rs|go|md|json|yaml|tsx|jsx)))(?!\]\])',
        r'[[\1]]',
        text
    )
    # DECISION: references
    text = re.sub(
        r'(DECISION|Decision|Decisão|decisão)[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-_]{3,60})',
        r'[[DECISION: \2]]',
        text
    )
    return text


def process_document(content: str, source_name: str) -> Optional[str]:
    """Processa um documento: extrai keywords, wikilinks, tags, gera nota .md."""
    if not content.strip():
        return None

    title = Path(source_name).stem.replace("_", " ").replace("-", " ").title()
    keywords = bm25_keywords(content)
    wikilinks = extract_wikilinks(content)
    tags = generate_tags(keywords, wikilinks, content)

    frontmatter = build_frontmatter(title, keywords, wikilinks, tags, source_name)
    body = convert_to_wikilinks(content.strip())

    return f"{frontmatter}\n\n{body}\n"


def process_file(filepath: Path, output_dir: Path) -> Optional[Path]:
    """Lê arquivo, processa, salva em output_dir."""
    try:
        content = filepath.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        sys.stderr.write(f"Erro lendo {filepath}: {e}\n")
        return None

    note = process_document(content, filepath.name)
    if not note:
        return None

    out_path = output_dir / f"{filepath.stem}.md"
    # Avoid overwriting if content is identical
    if out_path.exists():
        existing = out_path.read_text(encoding="utf-8")
        if existing == note:
            return out_path

    out_path.write_text(note, encoding="utf-8")
    return out_path


def scan_chronicle(output_dir: Path) -> int:
    """Varre ~/.codex/chronicle/ e processa arquivos .md novos/alterados."""
    if not CHRONICLE_DIR.exists():
        sys.stderr.write(f"Chronicle dir nao encontrado: {CHRONICLE_DIR}\n")
        return 0

    count = 0
    for f in sorted(CHRONICLE_DIR.glob("*.md")):
        if process_file(f, output_dir):
            count += 1
    return count


def process_stdin(output_dir: Path) -> int:
    """Lê JSONL do stdin e processa cada linha como sessão."""
    count = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        content = data.get("text") or data.get("content") or data.get("summary") or json.dumps(data)
        source = data.get("source", data.get("project", "stdin"))
        note = process_document(content, source)
        if note:
            timestamp = data.get("timestamp", data.get("created_at", datetime.now().isoformat()))
            safe_ts = re.sub(r"[^\w]", "_", timestamp)[:20]
            safe_source = re.sub(r"[^\w]", "_", str(source))[:30]
            out_path = output_dir / f"{safe_source}_{safe_ts}.md"
            out_path.write_text(note, encoding="utf-8")
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description="Chat Import Pipeline — Claude → Obsidian")
    parser.add_argument("--input", "-i", help="Arquivo ou diretório de entrada")
    parser.add_argument("--stdin", action="store_true", help="Lê JSONL do stdin")
    parser.add_argument("--output", "-o", default=str(CHATS_DIR), help="Diretório de saída (default: ~/gstack-vault/chats/)")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    os.makedirs(str(output_dir), exist_ok=True)

    count = 0

    if args.stdin:
        count = process_stdin(output_dir)
    elif args.input:
        input_path = Path(args.input)
        if input_path.is_file():
            if process_file(input_path, output_dir):
                count = 1
        elif input_path.is_dir():
            for f in sorted(input_path.glob("*.md")):
                if process_file(f, output_dir):
                    count += 1
        else:
            sys.stderr.write(f"Input nao encontrado: {input_path}\n")
            sys.exit(1)
    else:
        # Default: scan chronicle
        count = scan_chronicle(output_dir)

    print(f"Chat Import Pipeline: {count} notas salvas em {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
