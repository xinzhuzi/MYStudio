#!/usr/bin/env python3
"""Read-only R18 audit. Mechanical source matches are NOT identity/write approval."""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("entity_corpus_tool", Path(__file__).with_name("entity_corpus_tool.py"))
if _spec is None or _spec.loader is None:
    raise ImportError("Cannot load the local entity_corpus_tool module")
_corpus = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_corpus)
SECTION_RE = _corpus.SECTION_RE
KINDS = {"character": ("characters", "characterId"), "scene": ("scenes", "sceneId"), "prop": ("props", "assetId")}
MEDIA_SUFFIX = re.compile(r"\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$", re.IGNORECASE)
STORE = Path("store/studio-workflow")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--corpus-dir", required=True, type=Path)
    args = parser.parse_args()
    report = audit(args.project_root, args.corpus_dir)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["valid"] else 2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_safe(root, relative):
    """Open every component without following symlinks (including race swaps)."""
    parts = str(relative).split("/")
    require(not Path(relative).is_absolute() and all(p not in ("", ".", "..") and "\\" not in p for p in parts),
            f"unsafe path: {relative}")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        with os.fdopen(os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd), "rb") as stream:
            import stat
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), f"not a regular file: {relative}")
            return stream.read()
    finally:
        os.close(fd)


def unique_object(pairs):
    result = dict(pairs)
    require(len(result) == len(pairs), "duplicate JSON keys")
    return result


def load_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda value: require(False, f"invalid JSON constant: {value}"))


def inventory(project, corpus):
    # Names only: unlisted physical shards never supply records.
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def open_directory(path):
        absolute = path.absolute()
        fd = os.open(absolute.anchor, flags)
        try:
            for part in absolute.parts[1:]:
                require(part != "..", f"unsafe directory: {path}")
                child = os.open(part, flags, dir_fd=fd)
                os.close(fd)
                fd = child
            return fd
        except BaseException:
            os.close(fd)
            raise

    def scan(fd, prefix, recursive):
        names = []
        with os.scandir(fd) as entries:
            for entry in entries:
                relative = prefix / entry.name
                require(not entry.is_symlink(), f"symlink in inventory: {relative}")
                if entry.is_dir(follow_symlinks=False):
                    if recursive:
                        child = os.open(entry.name, flags, dir_fd=fd)
                        try:
                            names.extend(scan(child, relative, recursive))
                        finally:
                            os.close(child)
                elif entry.is_file(follow_symlinks=False) and (
                        relative.suffix == ".json" if recursive else
                        entry.name.startswith("batch-") and entry.name.endswith(".txt")):
                    names.append(str(relative))
        return tuple(sorted(names))

    store_fd = open_directory(project / STORE)
    try:
        shards = scan(store_fd, STORE, True)
    finally:
        os.close(store_fd)
    corpus_fd = open_directory(corpus)
    try:
        return shards, scan(corpus_fd, Path(), False)
    finally:
        os.close(corpus_fd)


def legacy_name(name):
    """Diagnostic copy of asset-names.ts:46–50, not a production parser."""
    parts = [part for part in re.split(r"[\\/]", name.strip()) if part]
    base = parts[-1] if parts else name.strip()
    return MEDIA_SUFFIX.sub("", base).strip() or base


def corpus_rows(corpus, names, read):
    rows, chapters, seen = [], set(), set()
    require(names, "no batch-*.txt corpus files")
    for name in names:
        chapter = None
        for line_number, raw in enumerate(read(corpus, Path(name)).decode("utf-8").splitlines(), 1):
            line = raw.strip()
            if not line:
                continue
            where = f"{corpus / name}:{line_number}"
            match = SECTION_RE.fullmatch(line)
            if match:
                chapter = match.group(1)
                require(chapter not in chapters, f"{where}: duplicate corpus chapter {chapter}")
                chapters.add(chapter)
                continue
            fields = [part.strip() for part in line[1:-1].split("|")]
            require(chapter and line.startswith("|") and line.endswith("|") and len(fields) == 5,
                    f"{where}: malformed corpus row: {raw}")
            kind, source_name, _aliases, episodes, note = fields
            kind = kind.lower()
            require(kind in KINDS and source_name and note, f"{where}: bad corpus fields: {raw}")
            require(not episodes or re.split(r"[,，]+", episodes) == [chapter], f"{where}: episode mismatch: {raw}")
            segments = [s.strip() for s in re.split(r"[;；,，]", source_name) if s.strip()]
            row_names = set()
            for segment in segments:
                # Match the name-column parser only; aliases and cross-row identity stay unchanged.
                normalized = re.sub(
                    r"[\t-\r \xA0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+",
                    "", segment).lower()
                if normalized in row_names:
                    continue
                row_names.add(normalized)
                key = (chapter, kind, segment)
                require(key not in seen, f"{where}: duplicate corpus name {key}: {raw}")
                seen.add(key)
                rows.append({"chapterId": chapter, "kind": kind, "name": segment, "note": note,
                             "file": str(corpus / name), "line": line_number, "raw": raw})
    return rows, chapters


def extraction_batches(project, read):
    manifest = load_json(read(project, STORE / "manifest.json"))
    require(isinstance(manifest, dict) and manifest.get("layout") == "studio-workflow-shards-v1"
            and type(manifest.get("version")) is int, "bad manifest schema")
    shards, index = manifest.get("shards"), manifest.get("chapterIndex")
    if not isinstance(shards, list) or not all(isinstance(s, str) and s for s in shards):
        raise ValueError("bad shards list")
    require(len(set(shards)) == len(shards), "duplicate manifest shard")
    if not isinstance(index, list) or not all(isinstance(c, dict) and isinstance(c.get("id"), str)
            and SECTION_RE.fullmatch("### " + c["id"]) for c in index):
        raise ValueError("bad chapterIndex")
    chapter_ids = {c["id"] for c in index}
    require(len(chapter_ids) == len(index), "duplicate chapterIndex")
    require(manifest.get("activeChapterId") is None or manifest["activeChapterId"] in chapter_ids, "bad activeChapterId")
    batches, batch_ids = {}, set()
    for relative in shards:
        path = STORE / relative
        # Validate before joining: absolute paths must not override STORE.
        require(not Path(relative).is_absolute(), f"unsafe shard: {relative}")
        payload = load_json(read(project, path))
        # The production merge reader ignores nonnumeric versions; state must remain an object.
        require(isinstance(payload, dict) and isinstance(payload.get("state"), dict),
                f"{path}: bad shard envelope")
        state = payload["state"]
        require("entityExtractions" in state or not Path(relative).name.startswith("entity-extractions"), f"{path}: missing entityExtractions")
        if "entityExtractions" not in state:
            continue
        items = state["entityExtractions"]
        require(isinstance(items, list), f"{path}: bad extraction array")
        for position, batch in enumerate(items):
            require(isinstance(batch, dict) and isinstance(batch.get("id"), str) and batch["id"], f"{path}: bad batch id")
            chapter = batch.get("episodeId")
            require(isinstance(chapter, str) and chapter in chapter_ids and Path(relative).parts[:2] == ("chapters", chapter), f"{path}: episode mismatch")
            require(chapter not in batches and batch["id"] not in batch_ids, f"{path}: duplicate chapter batch")
            for field in ("sourceId", "scriptFingerprint"):
                require(field not in batch or isinstance(batch[field], str), f"{path}: bad {field}")
            require("revision" not in batch or type(batch["revision"]) is int, f"{path}: bad revision")
            for field, id_field in KINDS.values():
                require(isinstance(batch.get(field), list), f"{path}: bad {field}")
                for entity in batch[field]:
                    require(isinstance(entity, dict) and all(isinstance(entity.get(k), str) and entity[k].strip() for k in ("name", id_field)), f"{path}: bad entity")
                    require("note" not in entity or isinstance(entity["note"], str), f"{path}: bad note")
                    require(isinstance(entity.get("aliases", []), list) and all(isinstance(a, str) for a in entity.get("aliases", [])), f"{path}: bad aliases")
            batch_ids.add(batch["id"])
            batches[chapter] = {"batch": batch, "path": str(project / path), "position": position}
    require(set(batches) == chapter_ids, f"batch coverage mismatch: missing={sorted(chapter_ids - set(batches))}")
    return batches, chapter_ids


def compare_names(rows, batches, hashes):
    findings = []
    for row in rows:
        proposed, old = row["name"], legacy_name(row["name"])
        if proposed == old:
            continue
        group = [r for r in rows if (r["chapterId"], r["kind"]) == (row["chapterId"], row["kind"])]
        entry = batches.get(row["chapterId"])
        field, id_field = KINDS[row["kind"]]
        entities = entry["batch"][field] if entry else []
        if any(proposed in [e["name"], *e.get("aliases", [])] for e in entities):
            continue
        matches = []
        for i, entity in enumerate(entities):
            for slot, value in [("name", entity["name"]), *[(f"aliases/{j}", a) for j, a in enumerate(entity.get("aliases", []))]]:
                if value == old:
                    matches.append({"batchId": entry["batch"]["id"], "entityId": entity[id_field],
                        "sourceId": entry["batch"].get("sourceId"), "revision": entry["batch"].get("revision"),
                        "scriptFingerprint": entry["batch"].get("scriptFingerprint"), "file": entry["path"],
                        "pointer": f'/state/entityExtractions/{entry["position"]}/{field}/{i}/{slot}',
                        "expectedOld": entity, "expectedOldName": value, "beforeSha256": hashes[entry["path"]]})
        unique = (len(matches) == 1 and sum(legacy_name(r["name"]) == old for r in group) == 1
                  and bool(row["note"]) and matches[0]["expectedOld"].get("note") == row["note"])
        findings.append({"chapterId": row["chapterId"], "kind": row["kind"], "proposedName": proposed,
            "legacyName": old, "classification": "unique_source_match" if unique else "ambiguous",
            "source": row, "matches": matches})
    return findings


def audit(project_root, corpus_dir):
    project, corpus = Path(project_root).absolute(), Path(corpus_dir).absolute()
    hashes, roots, errors, findings = {}, {}, [], []
    def read(root, path):
        raw = read_safe(root, path)
        key, digest = str(root / path), hashlib.sha256(raw).hexdigest()
        require(key not in hashes or hashes[key] == digest, f"input drift: {key}")
        hashes[key], roots[key] = digest, (root, path)
        return raw
    before = None
    try:
        before = inventory(project, corpus)
        batches, chapters = extraction_batches(project, read)
        rows, corpus_chapters = corpus_rows(corpus, before[1], read)
        require(corpus_chapters == chapters, f"corpus chapter coverage mismatch: missing={sorted(chapters - corpus_chapters)}, extra={sorted(corpus_chapters - chapters)}")
        findings = compare_names(rows, batches, hashes)
    except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
        errors.append(str(error))
    after_hashes = {}
    for key, (root, path) in roots.items():
        try:
            after_hashes[key] = hashlib.sha256(read_safe(root, path)).hexdigest()
            require(after_hashes[key] == hashes[key], f"input drift: {key}")
        except (OSError, ValueError) as error:
            errors.append(str(error))
    try:
        require(before == inventory(project, corpus), "input file inventory drift")
    except (OSError, ValueError) as error:
        errors.append(str(error))
    return {"valid": not errors, "status": "invalid" if errors else "valid", "productionWritten": False,
            "identityApproved": False, "errors": errors, "findings": [] if errors else findings,
            "beforeSha256": hashes, "afterSha256": after_hashes}


if __name__ == "__main__":
    raise SystemExit(main())
