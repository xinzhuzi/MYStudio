"""Isolated fixtures only; never load the real project or corpus."""

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("entity_extraction_name_fidelity_audit.py")
CHAPTER = "chapter-1569"
ORIGINAL = "戎州官道·自辖地东门/办公洞穴"
OLD = "办公洞穴"


def fixture(tmp_path, names=(OLD,), rows=None, note="入口"):
    root, corpus = tmp_path / "project", tmp_path / "corpus"
    store = root / "store/studio-workflow"
    shard = store / f"chapters/{CHAPTER}/entity-extractions-001-test.json"
    shard.parent.mkdir(parents=True)
    corpus.mkdir()
    batch = {"id": "batch-1", "episodeId": CHAPTER, "sourceId": "source-1", "revision": 1,
             "scriptFingerprint": "fingerprint", "characters": [], "props": [], "scenes": [
                 {"name": n, "sceneId": f"scene-{i}", "note": note, "aliases": []}
                 for i, n in enumerate(names)]}
    shard.write_text(json.dumps({"state": {"entityExtractions": [batch]}, "version": 1}))
    manifest = {"layout": "studio-workflow-shards-v1", "version": 1,
                "shards": [str(shard.relative_to(store))], "chapterIndex": [{"id": CHAPTER}],
                "activeChapterId": CHAPTER}
    (store / "manifest.json").write_text(json.dumps(manifest))
    (corpus / "batch-000.txt").write_text(f"### {CHAPTER}\n" + (rows or
        f"| scene | {ORIGINAL} | | {CHAPTER} | 入口 |\n"))
    return root, corpus, shard


def cli(root, corpus):
    proc = subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), "--project-root",
                           str(root), "--corpus-dir", str(corpus)], capture_output=True, text=True, check=False)
    assert proc.stdout, proc.stderr
    return proc.returncode, json.loads(proc.stdout)


def test_help_exposes_only_read_options():
    result = subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), "--help"],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0
    assert "--project-root" in result.stdout and "--corpus-dir" in result.stdout
    assert "--apply" not in result.stdout and "--output" not in result.stdout


@pytest.mark.parametrize("name,old", [(ORIGINAL, OLD), ("洞穴\\内室", "内室"),
                                      ("古画.PNG", "古画"), ("古画.mp4", "古画")])
def test_unique_match_and_readonly_hashes(tmp_path, name, old):
    root, corpus, shard = fixture(tmp_path, (old,), f"| scene | {name};副名 | | {CHAPTER} | 入口 |\n")
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in tmp_path.rglob("*") if p.is_file()}
    code, report = cli(root, corpus)
    assert code == 0 and report["valid"] and report["productionWritten"] is False
    item, = report["findings"]
    assert item["classification"] == "unique_source_match" and item["proposedName"] == name
    assert item["source"]["line"] == 2 and item["matches"][0]["batchId"] == "batch-1"
    assert item["matches"][0]["expectedOld"]["name"] == old
    assert item["matches"][0]["beforeSha256"] == before[str(shard)]
    assert before == {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in tmp_path.rglob("*") if p.is_file()}


def test_non_extraction_shard_string_version_matches_read_contract(tmp_path):
    root, corpus, shard = fixture(tmp_path)
    novel = shard.with_name("novel-chapters-007-test.json")
    novel.write_text(json.dumps({"state": {"novelChapters": []}, "version": "11"}))
    path = root / "store/studio-workflow/manifest.json"
    manifest = json.loads(path.read_text())
    manifest["shards"].append(str(novel.relative_to(path.parent)))
    path.write_text(json.dumps(manifest))
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in tmp_path.rglob("*") if p.is_file()}

    code, report = cli(root, corpus)

    assert code == 0 and report["valid"], report["errors"]
    assert report["findings"][0]["classification"] == "unique_source_match"
    assert report["beforeSha256"][str(novel)] == before[str(novel)]
    assert report["beforeSha256"] == report["afterSha256"]
    assert before == {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in tmp_path.rglob("*") if p.is_file()}


@pytest.mark.parametrize("payload", [[], {"state": []}, {"version": "11"}])
def test_bad_shard_envelope_still_fails_closed(tmp_path, payload):
    root, corpus, shard = fixture(tmp_path)
    shard.write_text(json.dumps(payload))

    code, report = cli(root, corpus)

    assert code == 2 and not report["valid"] and report["findings"] == []
    assert any("bad shard envelope" in error for error in report["errors"])


@pytest.mark.parametrize("names", [(ORIGINAL,), (ORIGINAL, OLD)])
def test_preserved_original_is_not_a_finding(tmp_path, names):
    assert cli(*fixture(tmp_path, names)[:2])[1]["findings"] == []


@pytest.mark.parametrize("names,note,extra", [((OLD, OLD), "入口", ""), ((OLD,), "不同", ""),
    ((), "入口", ""), ((OLD,), "入口", f"| scene | 别处/{OLD} | | {CHAPTER} | 入口 |\n"),
    ((OLD,), "入口", f"| scene | {OLD} | | {CHAPTER} | 入口 |\n")])
def test_ambiguous_never_claims_unique(tmp_path, names, note, extra):
    rows = f"| scene | {ORIGINAL} | | {CHAPTER} | 入口 |\n" + extra
    code, report = cli(*fixture(tmp_path, names, rows, note)[:2])
    assert code == 0 and all(f["classification"] == "ambiguous" for f in report["findings"])


@pytest.mark.parametrize("fault", ["missing", "duplicate", "bad-field", "wrong-episode",
    "duplicate-batch", "corpus-duplicate", "bad-row", "escape", "symlink", "store-link", "corpus-link"])
def test_invalid_inputs_fail_closed(tmp_path, fault):
    root, corpus, shard = fixture(tmp_path)
    path = root / "store/studio-workflow/manifest.json"
    manifest = json.loads(path.read_text())
    data = json.loads(shard.read_text())
    if fault == "missing": manifest["shards"].append("missing.json")
    if fault == "duplicate": manifest["shards"] *= 2
    if fault == "bad-field": data["state"]["entityExtractions"][0]["scenes"][0]["name"] = 3
    if fault == "wrong-episode": data["state"]["entityExtractions"][0]["episodeId"] = "chapter-001"
    if fault == "duplicate-batch": data["state"]["entityExtractions"] *= 2
    if fault == "corpus-duplicate": (corpus / "batch-001.txt").write_bytes((corpus / "batch-000.txt").read_bytes())
    if fault == "bad-row": (corpus / "batch-001.txt").write_text("not a table\n")
    if fault == "escape": manifest["shards"].append("../../outside.json")
    if fault == "symlink":
        (tmp_path / "outside.json").write_text("{}")
        (path.parent / "link.json").symlink_to(tmp_path / "outside.json")
        manifest["shards"].append("link.json")
    path.write_text(json.dumps(manifest))
    shard.write_text(json.dumps(data))
    if fault == "store-link":
        (root / "linked-project").mkdir()
        (root / "linked-project/store").symlink_to(root / "store", target_is_directory=True)
        root = root / "linked-project"
    if fault == "corpus-link":
        (tmp_path / "corpus-link").symlink_to(corpus, target_is_directory=True)
        corpus = tmp_path / "corpus-link"
    code, report = cli(root, corpus)
    assert code == 2 and not report["valid"] and report["errors"] and report["findings"] == []


@pytest.mark.parametrize("location", ["project-root", "store-root", "corpus-root",
                                      "store-directory", "corpus-directory", "store-file", "corpus-file"])
def test_symlinks_rejected_before_cross_root_enumeration(tmp_path, monkeypatch, location):
    root, corpus, shard = fixture(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.json").write_text("{}")
    if location == "project-root":
        linked = tmp_path / "linked-project"
        linked.symlink_to(root, target_is_directory=True)
        outside, root = root / "store/studio-workflow", linked
    elif location == "store-root":
        linked = tmp_path / "linked-project"
        linked.mkdir()
        (linked / "store").symlink_to(root / "store", target_is_directory=True)
        outside, root = root / "store/studio-workflow", linked
    elif location == "corpus-root":
        linked = tmp_path / "linked-corpus"
        linked.symlink_to(corpus, target_is_directory=True)
        outside, corpus = corpus, linked
    else:
        parent = shard.parent if location.startswith("store") else corpus
        is_directory = location.endswith("directory")
        (parent / "batch-link.txt").symlink_to(
            outside if is_directory else outside / "secret.json", target_is_directory=is_directory)
    spec = importlib.util.spec_from_file_location("fidelity_audit", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    scandir, visited = module.os.scandir, []
    def tracked(path):
        # fstat covers descriptor traversal without following a path in the test.
        actual = module.os.fstat(path) if isinstance(path, int) else module.os.stat(path)
        boundary = outside.stat()
        if (actual.st_dev, actual.st_ino) == (boundary.st_dev, boundary.st_ino):
            visited.append(path)
        return scandir(path)
    monkeypatch.setattr(module.os, "scandir", tracked)
    report = module.audit(root, corpus)
    assert visited == [], "enumerated a symlink target before rejecting it"
    assert not report["valid"] and report["errors"] and report["findings"] == []


@pytest.mark.parametrize("missing", ["empty-array", "unreferenced-shard", "indexed-chapter"])
def test_missing_entire_batch_invalidates_even_with_complete_corpus(tmp_path, missing):
    root, corpus, shard = fixture(tmp_path, ("完整名称",), f"| scene | 完整名称 | | {CHAPTER} | 入口 |\n")
    path = root / "store/studio-workflow/manifest.json"
    manifest = json.loads(path.read_text())
    if missing == "empty-array":
        data = json.loads(shard.read_text())
        data["state"]["entityExtractions"] = []
        shard.write_text(json.dumps(data))
    elif missing == "unreferenced-shard":
        manifest["shards"] = []
    else:
        manifest["chapterIndex"].append({"id": "chapter-1570"})
        (corpus / "batch-001.txt").write_text("### chapter-1570\n| scene | 完整名称 | | chapter-1570 | 入口 |\n")
    path.write_text(json.dumps(manifest))
    code, report = cli(root, corpus)
    assert code == 2 and not report["valid"] and report["findings"] == []
    assert any("batch coverage" in error for error in report["errors"])


@pytest.mark.parametrize("separator", [",", "，", ";", "；"])
def test_equivalent_secondary_segments_keep_first_source_spelling(tmp_path, separator):
    name = "庭 院/Office.PNG"
    row = f"| scene | {name}{separator}庭院/office.png{separator}{name} | 无关/别名 | {CHAPTER} | 入口 |\n"
    root, corpus, _ = fixture(tmp_path, ("Office",), row)
    code, report = cli(root, corpus)
    assert code == 0 and report["valid"]
    finding, = report["findings"]
    assert finding["classification"] == "unique_source_match"
    assert finding["proposedName"] == name and finding["source"]["raw"] == row.strip()


@pytest.mark.parametrize("space,equivalent", [("　", True), ("﻿", True), ("\u001f", False)])
def test_secondary_dedup_uses_javascript_whitespace_contract(tmp_path, space, equivalent):
    name = f"庭{space}院/内室"
    row = f"| scene | {name};庭院/内室 | | {CHAPTER} | 入口 |\n"
    root, corpus, _ = fixture(tmp_path, ("内室",), row)
    code, report = cli(root, corpus)
    assert code == 0 and report["valid"]
    assert len(report["findings"]) == (1 if equivalent else 2)
    assert all(item["classification"] == ("unique_source_match" if equivalent else "ambiguous")
               for item in report["findings"])


@pytest.mark.parametrize("name,stored", [("晏燎", "晏燎"), (ORIGINAL, ORIGINAL), (ORIGINAL, OLD)])
@pytest.mark.parametrize("second_note", ["入口", "另一条来源备注"])
def test_duplicate_source_rows_preserve_ambiguity_and_continue(tmp_path, name, stored, second_note):
    first = f"| scene | {name} | | {CHAPTER} | 入口 |"
    second = f"| scene | {name} | | {CHAPTER} | {second_note} |"
    root, corpus, shard = fixture(tmp_path, (stored,), first + "\n" + second + "\n")
    next_chapter = "chapter-1570"
    next_shard = shard.parent.parent / next_chapter / shard.name
    next_shard.parent.mkdir()
    data = json.loads(shard.read_text())
    batch = {**data["state"]["entityExtractions"][0], "id": "batch-2", "episodeId": next_chapter,
             "scenes": [{"name": "内室", "sceneId": "scene-next", "note": "入口", "aliases": []}]}
    next_shard.write_text(json.dumps({"state": {"entityExtractions": [batch]}, "version": 1}))
    manifest_path = root / "store/studio-workflow/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"].append(str(next_shard.relative_to(manifest_path.parent)))
    manifest["chapterIndex"].append({"id": next_chapter})
    manifest_path.write_text(json.dumps(manifest))
    (corpus / "batch-001.txt").write_text(
        f"### {next_chapter}\n| scene | 洞穴/内室 | | {next_chapter} | 入口 |\n")
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in tmp_path.rglob("*") if p.is_file()}

    code, report = cli(root, corpus)

    assert code == 0 and report["valid"], report["errors"]
    group, = report["repeatedSourceGroups"]
    assert (group["chapterId"], group["kind"], group["name"], group["classification"]) == (
        CHAPTER, "scene", name, "ambiguous")
    assert [(row["file"], row["line"], row["raw"], row["note"]) for row in group["sources"]] == [
        (str(corpus / "batch-000.txt"), 2, first, "入口"),
        (str(corpus / "batch-000.txt"), 3, second, second_note)]
    assert not any(item["classification"] == "unique_source_match" and item["chapterId"] == CHAPTER
                   for item in report["findings"])
    assert any(item["chapterId"] == next_chapter and item["classification"] == "unique_source_match"
               for item in report["findings"])
    if stored == OLD:
        assert len([item for item in report["findings"] if item["chapterId"] == CHAPTER]) == 2
    assert report["productionWritten"] is False and report["identityApproved"] is False
    assert report["coverageSummary"] == {
        "validated": True, "manifestChapterCount": 2, "extractionBatchCount": 2,
        "corpusChapterCount": 2, "corpusFileCount": 2, "corpusRowCount": 3,
        "corpusRowsByKind": {"character": 0, "scene": 3, "prop": 0}, "parsedNameCount": 3}
    assert before == {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in tmp_path.rglob("*") if p.is_file()}


def test_validated_coverage_counts_physical_rows_not_secondary_names(tmp_path):
    rows = (f"| scene | {ORIGINAL};副名 | | {CHAPTER} | 入口 |\n"
            f"| character | 晏燎 | | {CHAPTER} | 人物 |\n"
            f"| character | 晏燎 | | {CHAPTER} | 另一人物行 |\n"
            f"| prop | 古画.PNG | | {CHAPTER} | 画卷 |\n")
    root, corpus, _ = fixture(tmp_path, rows=rows)

    code, report = cli(root, corpus)

    assert code == 0 and report["valid"], report["errors"]
    assert report["coverageSummary"] == {
        "validated": True, "manifestChapterCount": 1, "extractionBatchCount": 1,
        "corpusChapterCount": 1, "corpusFileCount": 1, "corpusRowCount": 4,
        "corpusRowsByKind": {"character": 2, "scene": 1, "prop": 1}, "parsedNameCount": 5}
    group, = report["repeatedSourceGroups"]
    assert group["kind"] == "character" and group["name"] == "晏燎"
    assert [source["line"] for source in group["sources"]] == [3, 4]


@pytest.mark.parametrize("tail", ["not a table\n", f"### {CHAPTER}\n"])
def test_duplicate_sources_do_not_hide_fatal_input_or_publish_partial_counts(tmp_path, tail):
    row = f"| scene | {ORIGINAL} | | {CHAPTER} | 入口 |\n"
    root, corpus, _ = fixture(tmp_path, rows=row + row + tail)

    code, report = cli(root, corpus)

    assert code == 2 and not report["valid"] and report["errors"]
    assert report.get("coverageSummary") is None
    assert report["findings"] == [] and report["repeatedSourceGroups"] == []
    assert any(("malformed corpus row" if tail.startswith("not") else "duplicate corpus chapter")
               in error for error in report["errors"])


@pytest.mark.parametrize("change", ["new-corpus", "new-shard", "corpus", "manifest", "shard"])
def test_drift_invalidates_whole_report(tmp_path, monkeypatch, change):
    root, corpus, shard = fixture(tmp_path)
    spec = importlib.util.spec_from_file_location("fidelity_audit", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    compare = module.compare_names
    def changing(*args):
        target = {"new-corpus": corpus / "batch-new.txt", "new-shard": shard.parent / "new.json",
                  "corpus": corpus / "batch-000.txt", "manifest": root / "store/studio-workflow/manifest.json",
                  "shard": shard}[change]
        target.write_text(target.read_text() + "\n" if target.exists() else "{}")
        return compare(*args)
    monkeypatch.setattr(module, "compare_names", changing)
    report = module.audit(root, corpus)
    assert not report["valid"] and report["findings"] == [] and report["errors"]
    assert report.get("coverageSummary") is None and report["repeatedSourceGroups"] == []
