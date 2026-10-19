"""entity_merge_audit 离线合并审计测试锚(10-19-script-asset-extract-all-chapters C3;AC1)。

四规则(别名互含/编辑距离≤1/同首字+共现≥3章/名称包含)各一命中、无误报;
--coverage 计数正确;报告只写 --out、生产数据只读。

样本分片 schema 对齐盘上真身(state.entityExtractions[].characters/scenes/props,
types/studio-production-types.ts:713-741);出场索引 schema 对齐 C1
entity-appearances.ts:30-43(D23:条目含 aliases/importance);台账 schema 对齐
entity-extraction-ledger.ts:24-48。
"""
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import entity_merge_audit as audit  # noqa: E402

RULE_ALIAS = "别名互含"
RULE_EDIT = "编辑距离≤1"
RULE_COOCCUR = "同首字+共现≥3章"
RULE_CONTAIN = "名称包含"


def _character(name, aliases=None, importance=None):
    entry = {"name": name, "aliases": list(aliases or [])}
    if importance:
        entry["importance"] = importance
    return entry


def write_shard(root, chapter_id, batches=None, payload_raw=None):
    d = root / "store/studio-workflow/chapters" / chapter_id
    d.mkdir(parents=True, exist_ok=True)
    f = d / "entity-extractions-001-test.json"
    if payload_raw is not None:
        f.write_text(payload_raw, encoding="utf-8")
        return
    batch = {
        "id": f"ee-{chapter_id}",
        "episodeId": chapter_id,
        "characters": batches.get("characters", []),
        "scenes": batches.get("scenes", []),
        "props": batches.get("props", []),
        "sourceId": chapter_id,
        "revision": 1,
    }
    f.write_text(
        json.dumps(
            {"version": 2, "state": {"entityExtractions": [batch]}}, ensure_ascii=False
        ),
        encoding="utf-8",
    )


def build_project(tmp_path):
    """样本工程:四规则各一对命中 + 三类无误报样本 + 覆盖率账目。

    命中对(全部同 kind=character):
      秋水[小秋] × 涵秋[小秋]      → 别名互含(名距 2、无包含、异首字)
      李慕白 × 李幕白               → 编辑距离≤1(章不相交 → 共现 0,异……同首字李但共现<3)
      王大山 × 王二小               → 同首字王+共现 ch4-6=3(名距 2、无包含)
      赵四 × 监工赵四               → 名称包含(距 2、异首字、token 不交)
      赵四 × 赵四爷(索引独有条目)   → 索引消费证明(距 1 插入+包含)
    无误报样本:
      张铁林 × 张国荣(同首字张,共现 0)
      风 × 火(单字名,编辑距离规则不参与)
      青云(character) × 青云(scene)(规则仅同 kind)
    """
    root = tmp_path / "proj"
    write_shard(
        root,
        "chapter-001",
        batches={
            "characters": [
                _character("秋水", ["小秋"]),
                _character("独孤剑尘"),
                _character("李慕白"),
                _character("青云"),
                _character("风"),
                _character("火"),
            ],
            "scenes": [{"name": "青云"}],
        },
    )
    write_shard(
        root,
        "chapter-002",
        batches={
            "characters": [
                _character("涵秋", ["小秋"]),
                _character("赵四"),
                _character("张铁林"),
            ]
        },
    )
    write_shard(
        root,
        "chapter-003",
        batches={
            "characters": [_character("监工赵四"), _character("张国荣")]
        },
    )
    write_shard(
        root,
        "chapter-004",
        batches={"characters": [_character("李幕白"), _character("王大山"), _character("王二小")]},
    )
    for ch in ("chapter-005", "chapter-006"):
        write_shard(
            root, ch, batches={"characters": [_character("王大山"), _character("王二小")]}
        )
    write_shard(root, "chapter-007", payload_raw="{not json")

    extraction = root / "store/extraction"
    extraction.mkdir(parents=True)
    index = {
        "character:赵四爷": {
            "kind": "character",
            "name": "赵四爷",
            "aliases": [],
            "firstChapterId": "chapter-002",
            "chapterIds": ["chapter-002", "chapter-003"],
        }
    }
    (extraction / "entity-appearances.json").write_text(
        json.dumps(index, ensure_ascii=False), encoding="utf-8"
    )
    ledger = {
        "version": 1,
        "runId": "r1",
        "model": "glm-5.3",
        "range": [1, 8],
        "status": "paused",
        "resumeAt": None,
        "chapters": {
            "chapter-001": {"state": "success"},
            "chapter-007": {
                "state": "failed",
                "error": "input_truncated: drama read truncated",
                "attempts": 1,
            },
        },
    }
    (extraction / "extraction-run.json").write_text(
        json.dumps(ledger, ensure_ascii=False), encoding="utf-8"
    )
    manifest = {"chapterIndex": [{"id": f"chapter-00{n}"} for n in range(1, 9)]}
    (root / "store/studio-workflow/manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    return root


def run_cli(root, out=None, extra=()):
    cmd = [
        sys.executable,
        str(SCRIPTS_DIR / "entity_merge_audit.py"),
        "--project-root",
        str(root),
    ]
    if out is not None:
        cmd += ["--out", str(out)]
    cmd += list(extra)
    return subprocess.run(cmd, capture_output=True, text=True)


def pair_map(out_dir):
    """CSV → {按名排序的实体对: 规则集合}。"""
    with open(out_dir / "entity-merge-audit.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    result = {}
    for row in rows:
        key = tuple(sorted([row["实体A"], row["实体B"]]))
        result[key] = set(row["命中规则"].split("、"))
    return result


def tree_digest(root):
    items = []
    for p in sorted(Path(root).rglob("*")):
        if p.is_file():
            items.append((str(p.relative_to(root)), hashlib.sha256(p.read_bytes()).hexdigest()))
    return items


def test_four_rules_each_hit_exactly(tmp_path):
    root = build_project(tmp_path)
    out = tmp_path / "out"
    proc = run_cli(root, out)
    assert proc.returncode == 0, proc.stderr
    m = pair_map(out)
    assert m.get(tuple(sorted(["赵四", "监工赵四"]))) == {RULE_CONTAIN}
    assert m.get(tuple(sorted(["秋水", "涵秋"]))) == {RULE_ALIAS}
    assert m.get(tuple(sorted(["李慕白", "李幕白"]))) == {RULE_EDIT}
    assert m.get(tuple(sorted(["王大山", "王二小"]))) == {RULE_COOCCUR}


def test_index_entries_enter_audit_universe(tmp_path):
    root = build_project(tmp_path)
    out = tmp_path / "out"
    proc = run_cli(root, out)
    assert proc.returncode == 0, proc.stderr
    m = pair_map(out)
    # 索引独有条目「赵四爷」与分片「赵四」成对:插入一字(距1)+名称包含。
    assert m.get(tuple(sorted(["赵四", "赵四爷"]))) == {RULE_EDIT, RULE_CONTAIN}


def test_no_false_positives(tmp_path):
    root = build_project(tmp_path)
    out = tmp_path / "out"
    proc = run_cli(root, out)
    assert proc.returncode == 0, proc.stderr
    m = pair_map(out)
    assert tuple(sorted(["张铁林", "张国荣"])) not in m  # 同首字但共现 0
    assert ("风", "火") not in m  # 单字名不参与编辑距离规则,余规则不命中
    assert ("青云", "青云") not in m  # 同名异 kind 不配对
    csv_text = (out / "entity-merge-audit.csv").read_text(encoding="utf-8-sig")
    md_text = (out / "entity-merge-audit.md").read_text(encoding="utf-8")
    for absent in ("张铁林", "张国荣", "独孤剑尘"):
        assert absent not in csv_text
        assert absent not in md_text


def test_report_files_written(tmp_path):
    root = build_project(tmp_path)
    out = tmp_path / "out"
    proc = run_cli(root, out)
    assert proc.returncode == 0, proc.stderr
    md = out / "entity-merge-audit.md"
    csv_path = out / "entity-merge-audit.csv"
    assert md.exists() and csv_path.exists()
    assert "实体合并审计报告" in md.read_text(encoding="utf-8")
    assert "监工赵四" in md.read_text(encoding="utf-8")


def test_coverage_counts_and_failures(tmp_path):
    root = build_project(tmp_path)
    proc = run_cli(root, extra=["--coverage"])
    assert proc.returncode == 0, proc.stderr
    out = proc.stdout
    assert "总章数(manifest): 8" in out
    assert "已覆盖: 6" in out  # chapter-001..006;007 分片损坏不计
    assert "覆盖率: 75.0%" in out
    assert "chapter-007" in out  # 解析失败清单
    assert "chapter-008" in out  # 无分片章清单
    assert "input_truncated: drama read truncated" in out  # 台账失败清单


def test_production_tree_untouched(tmp_path):
    root = build_project(tmp_path)
    before = tree_digest(root)
    out = tmp_path / "out"
    proc = run_cli(root, out, extra=["--coverage"])
    assert proc.returncode == 0, proc.stderr
    assert tree_digest(root) == before  # 只读铁律:生产树字节不变


def test_usage_requires_out_or_coverage(tmp_path):
    root = build_project(tmp_path)
    proc = run_cli(root)
    assert proc.returncode == 2


def test_normalize_name_parity_with_frontend():
    # entity-extraction.ts:230-236:全角转半角 + lower + 去空白。
    assert audit.normalize_name("Ａｂｃ") == "abc"
    assert audit.normalize_name("王　二\n三") == "王二三"  # 全角空格/换车均去
    assert audit.normalize_name("  赵四 ") == "赵四"
    assert audit.normalize_name("！") == "!"


def test_edit_distance_helper_boundaries():
    assert audit.edit_distance_le_one("abc", "abcd")  # 插入
    assert audit.edit_distance_le_one("ab", "acb")  # 插入(中位)
    assert audit.edit_distance_le_one("李慕白", "李幕白")  # 替换
    assert not audit.edit_distance_le_one("abc", "axcy")
    assert not audit.edit_distance_le_one("ab", "abcd")
    assert audit.edit_distance_le_one("a", "b")  # 函数层距离1;规则层另设名长≥2守卫
