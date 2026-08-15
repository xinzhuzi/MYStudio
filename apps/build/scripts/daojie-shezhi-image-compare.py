#!/usr/bin/env python3
"""Compare MYStudio daojie manual images against the 道劫设定集 corpus.

Borrows the local-audit philosophy from ma-imagegen (Design-side skill):
deterministic, model-free evidence only — no CLIP, no network.

Layers of comparison per target image:
  1. SHA-256 exact match (chunked read, same as utils/hashing.py)
  2. Perceptual hashes: 64-bit aHash + dHash, hamming distance
  3. Confirmation signal: 64x64 grayscale RMSE for top pHash candidates

Thumbs: 设定集 keeps `<name>_thumb.jpg` next to full-size images. A thumb
match is reported with its sibling full-size path so replacement candidates
always point at production-grade files.

Usage:
  python3 daojie-shezhi-image-compare.py \
    --corpus "/path/to/1.设定集" \
    --report-dir ../../output/automation/daojie-shezhi-compare
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
HASH_RESIZE = (9, 8)          # dHash gradient width x height
AHASH_GRID = (8, 8)
RMSE_SIZE = (64, 64)
DHAMMING_NEAR = 12            # dHash bits differing out of 64
AHAMMING_NEAR = 16
TOP_N = 20

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CORPUS = Path(
    "/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/1.设定集"
)
DEFAULT_TARGETS = [
    REPO_ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/images",
    REPO_ROOT / "apps/frontend/assets/studio-manuals/story_skills/Daojie_xianxia",
    Path.home() / "Library/Application Support/漫影工作室/skills/art_skills/daojie_ink_guofeng/images",
    Path.home() / "Library/Application Support/漫影工作室/skills/story_skills/Daojie_xianxia",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bits(matrix: list[list[float]]) -> int:
    flat = [v for row in matrix for v in row]
    mean = sum(flat) / max(1, len(flat))
    value = 0
    for v in flat:
        value = (value << 1) | (1 if v > mean else 0)
    return value


def ahash(image: Image.Image) -> int:
    gray = image.convert("L").resize(AHASH_GRID)
    return _bits([[gray.getpixel((x, y)) for x in range(8)] for y in range(8)])


def dhash(image: Image.Image) -> int:
    gray = image.convert("L").resize(HASH_RESIZE)
    matrix = [[gray.getpixel((x, y)) for x in range(9)] for y in range(8)]
    value = 0
    for row in matrix:
        for x in range(8):
            value = (value << 1) | (1 if row[x] > row[x + 1] else 0)
    return value


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def gray_rmse(a: Image.Image, b: Image.Image) -> float:
    ga = a.convert("L").resize(RMSE_SIZE)
    gb = b.convert("L").resize(RMSE_SIZE)
    pa, pb = list(ga.getdata()), list(gb.getdata())
    total = sum((x - y) ** 2 for x, y in zip(pa, pb))
    return (total / len(pa)) ** 0.5


def is_thumb(path: Path) -> bool:
    return path.stem.endswith("_thumb")


def full_sibling(path: Path) -> str | None:
    if not is_thumb(path):
        return None
    for suffix in SUFFIXES:
        cand = path.with_name(path.stem[: -len("_thumb")] + suffix)
        if cand.exists():
            return str(cand)
    return None


def index_one(item: tuple[str, str]) -> dict[str, Any] | None:
    path_str, corpus_root_str = item
    path = Path(path_str)
    corpus_root = Path(corpus_root_str)
    try:
        with Image.open(path) as im:
            im.load()
            width, height = im.size
            ah, dh = ahash(im), dhash(im)
            luma_thumb = im.convert("L").resize((8, 8))
        try:
            rel = str(path.relative_to(corpus_root))
        except ValueError:
            rel = str(path)
        return {
            "path": str(path),
            "rel": rel,
            "size": path.stat().st_size,
            "width": width,
            "height": height,
            "ahash": ah,
            "dhash": dh,
            "thumb_luma": list(luma_thumb.getdata()),
            "is_thumb": is_thumb(path),
            "error": None,
        }
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        return {"path": str(path), "error": f"{type(exc).__name__}: {exc}"}


def collect(root: Path) -> list[str]:
    return sorted(
        str(p) for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in SUFFIXES
    )


@dataclass
class Candidate:
    corpus_path: str
    dhash_distance: int
    ahash_distance: int
    rmse: float | None = None
    is_thumb: bool = False
    full_sibling: str | None = None


@dataclass
class TargetReport:
    target_path: str
    sha256: str
    width: int
    height: int
    exact_matches: list[str] = field(default_factory=list)
    near_matches: list[dict[str, Any]] = field(default_factory=list)
    verdict: str = "no_match"


def compare_target(target_path: Path, corpus_index: list[dict[str, Any]],
                   dhash_max: int, ahash_max: int) -> TargetReport:
    sha = sha256_file(target_path)
    with Image.open(target_path) as im:
        im.load()
        w, h = im.size
        tah, tdh = ahash(im), dhash(im)

    report = TargetReport(str(target_path), sha, w, h)

    # Exact-duplicate confirmation sha is computed only for pHash pre-matches
    # (sha over the whole 14k corpus would double runtime for no gain).
    candidates: list[Candidate] = []
    for c in corpus_index:
        if c.get("error"):
            continue
        dh_dist = hamming(tdh, c["dhash"])
        if dh_dist > dhash_max:
            continue
        ah_dist = hamming(tah, c["ahash"])
        if ah_dist > ahash_max:
            continue
        candidates.append(
            Candidate(c["path"], dh_dist, ah_dist, is_thumb=c["is_thumb"],
                      full_sibling=full_sibling(Path(c["path"])))
        )

    candidates.sort(key=lambda c: c.dhash_distance)
    confirmed = candidates[:8]
    with Image.open(target_path) as im:
        im.load()
        for cand in confirmed:
            try:
                with Image.open(cand.corpus_path) as cim:
                    cand.rmse = gray_rmse(im, cim)
            except OSError:
                cand.rmse = None
            if cand.dhash_distance <= 8 and sha256_file(Path(cand.corpus_path)) == sha:
                report.exact_matches.append(cand.corpus_path)
    candidates.sort(key=lambda c: (c.dhash_distance, c.rmse if c.rmse is not None else 999))
    report.near_matches = [asdict(c) for c in candidates[:TOP_N] if c.rmse is not None or not confirmed]
    if report.exact_matches:
        report.verdict = "exact_match"
    elif candidates:
        report.verdict = "near_match"
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--targets", nargs="*", type=Path, default=None)
    parser.add_argument("--report-dir", type=Path, default=None)
    parser.add_argument("--workers", type=int, default=max(2, mp.cpu_count() - 2))
    parser.add_argument("--dhash-max", type=int, default=DHAMMING_NEAR,
                        help="max dHash hamming distance to count as near (loose: 24-30)")
    parser.add_argument("--ahash-max", type=int, default=AHAMMING_NEAR)
    parser.add_argument("--include-outputs", action="store_true",
                        help="also compare apps/output/automation/daojie-* render outputs")
    args = parser.parse_args()

    started = time.time()
    corpus_files = collect(args.corpus)
    print(f"[corpus] {len(corpus_files)} images under {args.corpus}")

    work = [(p, str(args.corpus)) for p in corpus_files]
    with mp.Pool(args.workers) as pool:
        indexed: list[dict[str, Any]] = []
        done = 0
        for rec in pool.imap_unordered(index_one, work, chunksize=64):
            done += 1
            if done % 1000 == 0:
                print(f"[index] {done}/{len(corpus_files)} ({time.time()-started:.0f}s)")
            indexed.append(rec)

    errors = [r for r in indexed if r.get("error")]
    corpus_index = [r for r in indexed if not r.get("error")]
    print(f"[index] ok={len(corpus_index)} errors={len(errors)}")

    target_roots = [t for t in DEFAULT_TARGETS if t.exists()]
    if args.targets:
        target_roots = args.targets
    if args.include_outputs:
        target_roots += sorted(
            (REPO_ROOT / "apps/output/automation").glob("daojie-*")
        )
    target_files = sorted(
        {p for root in target_roots for p in collect(root)}
    )
    # dedupe byte-identical targets (repo vs app-storage copies)
    by_sha: dict[str, Path] = {}
    for p in target_files:
        by_sha.setdefault(sha256_file(Path(p)), Path(p))
    targets = sorted(by_sha.values())
    print(f"[targets] {len(target_files)} files -> {len(targets)} unique "
          f"(deduped identical copies)")

    reports = []
    for tp in targets:
        print(f"[compare] {tp.name} ...")
        reports.append(compare_target(tp, corpus_index, args.dhash_max, args.ahash_max))

    report_dir = args.report_dir or (
        REPO_ROOT / "apps/output/automation" /
        f"daojie-shezhi-compare-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    report_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "mystudio.daojie.shezhi.compare.v1",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "corpus_root": str(args.corpus),
        "corpus_count": len(corpus_files),
        "corpus_errors": errors[:50],
        "thresholds": {"dhash": args.dhash_max, "ahash": args.ahash_max},
        "targets": [asdict(r) for r in reports],
    }
    report_path = report_dir / "report.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"[report] {report_path}")

    for r in reports:
        print(f"\n=== {Path(r.target_path).name} ({r.width}x{r.height}) -> {r.verdict}")
        if r.exact_matches:
            for m in r.exact_matches:
                print(f"  EXACT  {m}")
        for n in r.near_matches[:5]:
            rmse = f"{n['rmse']:.1f}" if n.get("rmse") is not None else "n/a"
            thumb = " [thumb]" if n["is_thumb"] else ""
            sib = f" -> full: {n['full_sibling']}" if n.get("full_sibling") else ""
            print(f"  near   d={n['dhash_distance']:2d}/a={n['ahash_distance']:2d} rmse={rmse}{thumb} {Path(n['corpus_path']).name}{sib}")
    print(f"\n[done] {time.time()-started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
