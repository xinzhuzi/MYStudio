#!/usr/bin/env python3
"""Audit the production component import/export graph."""

from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_ROOT = REPO_ROOT / "apps" / "frontend"
COMPONENT_ROOT = FRONTEND_ROOT / "components"
SOURCE_SUFFIXES = {".ts", ".tsx"}
EXCLUDED_PATH_PARTS = {"fixtures", "__fixtures__", "__tests__", "tests", "spec"}
IMPORT_PATTERN = re.compile(
    r"(?:from\s+|import\s*\(\s*|import\s+)[\"']([^\"']+)[\"']"
)


def production_components() -> list[Path]:
    return sorted(
        path
        for path in COMPONENT_ROOT.rglob("*")
        if path.is_file()
        and path.suffix in SOURCE_SUFFIXES
        and not path.name.endswith(".d.ts")
        and ".test." not in path.name
        and ".spec." not in path.name
        and not any(part in EXCLUDED_PATH_PARTS for part in path.relative_to(COMPONENT_ROOT).parts)
    )


def resolve_import(source: Path, specifier: str) -> Path | None:
    if specifier.startswith("@/"):
        base = FRONTEND_ROOT / specifier[2:]
    elif specifier.startswith("."):
        base = source.parent / specifier
    else:
        return None
    candidates = (
        base,
        Path(f"{base}.ts"),
        Path(f"{base}.tsx"),
        base / "index.ts",
        base / "index.tsx",
    )
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


def find_cycles(adjacency: dict[str, set[str]]) -> list[list[str]]:
    cycles: list[list[str]] = []
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []

    def visit(node: str) -> None:
        if node in visiting:
            start = stack.index(node)
            cycles.append(stack[start:] + [node])
            return
        if node in visited:
            return
        visiting.add(node)
        stack.append(node)
        for child in sorted(adjacency.get(node, set())):
            visit(child)
        stack.pop()
        visiting.remove(node)
        visited.add(node)

    for node in sorted(adjacency):
        visit(node)
    return cycles


def main() -> None:
    files = production_components()
    component_paths = {path.resolve() for path in files}
    edges: set[tuple[str, str]] = set()
    unresolved: set[tuple[str, str]] = set()
    adjacency: dict[str, set[str]] = {str(path.resolve()): set() for path in files}
    for source in files:
        source_key = str(source.resolve())
        for specifier in IMPORT_PATTERN.findall(source.read_text(encoding="utf-8", errors="ignore")):
            target = resolve_import(source, specifier)
            if target is None and (specifier.startswith("@/") or specifier.startswith(".")):
                unresolved.add((source_key, specifier))
                continue
            if target not in component_paths:
                continue
            target_key = str(target)
            edges.add((source_key, target_key))
            adjacency[source_key].add(target_key)
    cycles = find_cycles(adjacency)
    payload = {
        "root": str(COMPONENT_ROOT.relative_to(REPO_ROOT)),
        "production_files": len(files),
        "internal_edges": len(edges),
        "unresolved_imports": [
            {"source": source, "specifier": specifier}
            for source, specifier in sorted(unresolved)
        ],
        "cycles": cycles,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
