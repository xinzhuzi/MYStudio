"""Offline Round14 leaf-only migration, backups and SHA evidence."""

from __future__ import annotations

import argparse
import ast
import difflib
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / ".trellis/tasks/10-20-trellis-audit-remediation/research/round14-default-turbo"
COMFY = ROOT / "apps/backend/comfyui"
TURBO = "0 · Turbo 8步"
AUTO = "自动 · 按型"
WORKFLOWS = COMFY / "workflows"
T2I = next(WORKFLOWS.rglob("qi21-道劫-t2i.json"))
I2I = next(WORKFLOWS.rglob("qi21-道劫-i2i.json"))
FIXTURE = COMFY / "tests/fixtures/qi21_object_info_snapshot.json"
CHANGED = [
    COMFY / "my_nodes/nodes/my_qi21_speed_select.py",
    COMFY / "my_nodes/tests/test_my_qi21_speed_select.py",
    COMFY / "tests/test_qwen21_workflow_contract.py",
    FIXTURE,
    ROOT / "apps/backend/engines/image_engine/qwen21.py",
    T2I,
    I2I,
]
FROZEN = [
    next(WORKFLOWS.rglob("qi21-edit.json")),
    next(WORKFLOWS.rglob("qwen21-道劫-t2i-api.json")),
    next(WORKFLOWS.rglob("qwen21-道劫-i2i-api.json")),
    *sorted((COMFY / "my_nodes/subgraphs").glob("qi21-道劫-加速子图*.json")),
]
REPLACEMENTS = [
    ("1017 增档令(推翻 1008 Turbo 默认令;首项=自动=全局出厂默认,",
     "1021 默认 Turbo 令(首项=Turbo=全局出厂默认;自动为手动选项,"),
    (f"全局首项=「{AUTO}」", f"全局首项=「{TURBO}」"),
    (f"全局出厂首项=「{AUTO}」", f"全局出厂首项=「{TURBO}」"),
    ("1017 增档令:按型名自动路由——", "手动选择「自动 · 按型」时:按型名自动路由——"),
    ("Turbo 居二/原生出图居三/viggle 居四", "Turbo 居首/原生出图居二/viggle 居三/自动居末"),
    ("推翻 1009/1016 Turbo 默认令;", "1021 默认 Turbo 令;"),
    ("默认「自动 · 按型」（", "默认「0 · Turbo 8步」（全部类型均走 Turbo 官方 8 步直挂）；可手动选择「自动 · 按型」（"),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(name: str, payload: object) -> None:
    (EVIDENCE / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def leaf_plan() -> list[dict]:
    leaves = []
    for path in (T2I, I2I):
        graph = json.loads(path.read_text())
        index = next(index for index, node in enumerate(graph["nodes"]) if node["id"] == 402)
        note = graph["nodes"][index]
        for keys in (("widgets_values", 0), ("widgets_values_named", "text")):
            before = note[keys[0]][keys[1]]
            after = before
            for old, new in REPLACEMENTS:
                after = after.replace(old, new)
            assert before != after
            leaves.append({"path": str(path.relative_to(ROOT)),
                           "json_path": ["nodes", index, *keys],
                           "before": before, "after": after})
    leaves.append({"path": str(FIXTURE.relative_to(ROOT)),
                   "json_path": ["MyQi21SpeedSelect", "input", "required", "mode"],
                   "before": json.loads(FIXTURE.read_text())["MyQi21SpeedSelect"]["input"]["required"]["mode"],
                   "after": [[TURBO, "1 · 原生出图", "2 · viggle", AUTO], {"default": TURBO}]})
    return leaves


def prepare() -> None:
    manifest_path = EVIDENCE / "before-manifest.json"
    assert not manifest_path.exists(), "Existing baseline must not be overwritten"
    records = []
    for path in CHANGED + FROZEN:
        relative = path.relative_to(ROOT)
        backup = EVIDENCE / "backups" / relative
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
        records.append({"path": str(relative), "sha256": digest(path),
                        "backup": str(backup.relative_to(ROOT)),
                        "ownership": "modify" if path in CHANGED else "frozen"})
    dump("before-manifest.json", records)
    tests = []
    for path in CHANGED[1:3]:
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.FunctionDef) and node.name in {
                "test_combo_closed_set_first_item_is_default_turbo",
                "test_select_default_mode_picks_turbo_branch",
                "test_combo_closed_set_and_default_first",
                "test_note_402_auto_gear_tokens",
            }:
                tests.append({"path": str(path.relative_to(ROOT)), "symbol": node.name,
                              "line": node.lineno})
    dump("planned-changes.json", {
        "boundary": "L1 offline only; no generate/install/restart/git; methods and API graphs frozen",
        "checkpoint": {
            "facts": "Saved three canvases, three acceleration blueprints and two API templates already Turbo",
            "hypothesis": "Combo first/default AUTO routes three types to native; regression must fail before fix",
            "solution": "Reorder constants only; sync current notes, exact fixture mode and engine metadata",
            "counterexample": "Explicit AUTO must still route three native types; explicit saved choices unchanged",
            "scope": "Seven owned leaves/files; no parent artifacts, spec, generation, layout, bindings or methods",
            "stop": "Unexpected test failure or non-allowlisted JSON change requires investigation, not skips",
        },
        "json_leaves": leaf_plan(), "existing_tests": tests,
        "new_tests": ["default/lazy all ten types+free+empty+missing", "explicit AUTO routing",
                      "fixture default interlock", "engine SPEC and real instantiate/mock generate Turbo8"],
        "files": records,
    })
    print(f"Prepared {len(records)} backups, {len(tests)} existing test locations, 5 JSON leaves")


def apply_json() -> None:
    plan = json.loads((EVIDENCE / "planned-changes.json").read_text())
    for path in (T2I, I2I, FIXTURE):
        before = path.read_text()
        after = before
        for leaf in plan["json_leaves"]:
            if leaf["path"] != str(path.relative_to(ROOT)):
                continue
            if isinstance(leaf["before"], str):
                old = json.dumps(leaf["before"], ensure_ascii=False)
                new = json.dumps(leaf["after"], ensure_ascii=False)
                assert after.count(old) >= 1
                after = after.replace(old, new, 1)
            else:
                data = json.loads(after)
                data["MyQi21SpeedSelect"]["input"]["required"]["mode"] = leaf["after"]
                encoded = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
                assert json.dumps(json.loads(before), ensure_ascii=False, indent=2) + "\n" == before
                after = encoded
        patch_lines = list(difflib.unified_diff(before.splitlines(), after.splitlines(), n=3))
        hunks = ["@@" if line.startswith("@@") else line for line in patch_lines[2:]]
        patch = "*** Begin Patch\n*** Update File: " + str(path.relative_to(ROOT)) + "\n" + "\n".join(hunks) + "\n*** End Patch\n"
        subprocess.run(["apply_patch", patch], cwd=ROOT, check=True)
    print("Applied only the five planned JSON leaves via apply_patch")


def verify() -> None:
    manifest = json.loads((EVIDENCE / "before-manifest.json").read_text())
    plan = json.loads((EVIDENCE / "planned-changes.json").read_text())
    records = []
    for record in manifest:
        path = ROOT / record["path"]
        after_sha = digest(path)
        if record["ownership"] == "frozen":
            assert record["sha256"] == after_sha, record["path"]
        elif path.suffix == ".json":
            expected = json.loads((ROOT / record["backup"]).read_text())
            for leaf in plan["json_leaves"]:
                if leaf["path"] == record["path"]:
                    parent = expected
                    for key in leaf["json_path"][:-1]:
                        parent = parent[key]
                    parent[leaf["json_path"][-1]] = leaf["after"]
            assert json.loads(path.read_text()) == expected, record["path"]
        elif path in (CHANGED[0], CHANGED[4]):
            before_text = (ROOT / record["backup"]).read_text()
            after_text = path.read_text()
            before_tree = ast.parse(before_text)
            after_tree = ast.parse(after_text)
            before_functions = {node.name: ast.get_source_segment(before_text, node)
                                for node in ast.walk(before_tree) if isinstance(node, ast.FunctionDef)}
            after_functions = {node.name: ast.get_source_segment(after_text, node)
                               for node in ast.walk(after_tree) if isinstance(node, ast.FunctionDef)}
            assert before_functions == after_functions, record["path"]
        records.append({**record, "before_sha256": record["sha256"], "after_sha256": after_sha,
                        "changed": record["sha256"] != after_sha,
                        "summary": "Default Turbo and current metadata/notes regression" if record["ownership"] == "modify" else "Byte-identical frozen input"})
    records.append({"path": str(Path(__file__).relative_to(ROOT)), "backup": None,
                    "before_sha256": None, "after_sha256": digest(Path(__file__)),
                    "changed": True, "ownership": "created",
                    "summary": "Offline backup, exact JSON patch and frozen-input verification"})
    dump("changes.json", records)
    print(f"Verified {len(CHANGED)} owned files and {len(FROZEN)} frozen files; JSON leaf allowlist exact")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "apply-json", "verify"))
    arguments = parser.parse_args()
    {"prepare": prepare, "apply-json": apply_json, "verify": verify}[arguments.phase]()
