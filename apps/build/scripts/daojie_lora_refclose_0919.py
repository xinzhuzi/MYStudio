#!/usr/bin/env python3
"""柔水彩清除令收尾 + 既有断链修复(09-19 LoRA 治理 R4;零文件删除)。

动作全属两类:摘除指向已删/不存在文件的 LoRA 旁路节点(链位 splice 直连,
算法=daojie_softwatercolor_purge_0919/a245ce9 同款)+ 改路径对齐实名。

  ① K2-文生图-超集.json / K2-文生图-风格参照.json / K2-角色设定-道劫.json:
     摘 [68] 柔水彩(物理文件已按用户令删净)+ [70] 复古漫(该件从未在盘上)
     两枚 LoraLoaderModelOnly,速查卡 [66] 同步删行;
  ② 引擎家用户区旧名副本 MY-K2_文生图_超集/MY-K2_文生图_道劫.json 同款摘除
     (清除令覆盖全部残引;改前备份 /tmp/lora_refclose_home_backup_0919/);
  ③ DynamicCharacterSheet_krea2_v1.json [164] lora 路径对齐盘上实名
     krea/krea2_charactersheet_full_v1.safetensors → DynamicCharacterSheet_krea2_v1.safetensors;
  ④ 社区-480P生成-潜空间放大到960P.json [41] widgets_values_named.lora_name
     对齐已本地化的 positional 值(Minimax_H3\\…lightx2v… → 盘上 turbo 4step 实名)。

明确不动:
  - K2-文生图-道劫.json(仓库+引擎家两份)——并行会话正在改,本轮零接触;
  - 官方本地-R2V-480P-需解冻ref2va.json [145](active 引用 minimax_h3_ref2v_turbo
    系盘上从未有过的件;H3 线+下装/摘除须用户选,进台账勾选,不属本脚本两类动作)。

全幂等:重复运行零变化。改后逐文件跑 workflow_graph_lint.py 门禁。
回写 ensure_ascii=False + indent=2,无尾换行(库内约定)。
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows"
HOME_WF = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
           / "ComfyUI/user/default/workflows")
LINT = REPO / "apps/build/scripts/workflow_graph_lint.py"
BACKUP = Path("/tmp/lora_refclose_home_backup_0919")

DEAD_LORAS = {
    "Krea2-画风/Krea2-柔水彩softwatercolor.safetensors",   # 用户令删净(a245ce9)
    "Krea2-画风/Krea2-复古漫retroanime.safetensors",       # 从未在盘上
}
NOTE_MARKS = ("softwatercolor", "retroanime")  # 卡内死引行判定(含路径/英文名)
# 幽灵节点号清理:摘除后卡文枚举里仍指 [68]/[70] 的行段(反面教材=[70] 幽灵引用)
GHOST_TEXT_FIXES = [
    ("画风件[68/69/70]一次只开一枚", "画风件[69]一次只开一枚"),
    ("画风件(68/69/70/73/76/77/78)一次一枚", "画风件(69/73/76/77/78)一次一枚"),
]

REMOVE_TARGETS = [
    WF / "1_图片/K2图像/1_文生图/K2-文生图-超集.json",
    WF / "1_图片/K2图像/1_文生图/K2-文生图-风格参照.json",
    WF / "1_图片/K2图像/2_图生图/K2-角色设定-道劫.json",
    HOME_WF / "1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json",
    HOME_WF / "1_图片/K2图像/1_文生图/MY-K2_文生图_道劫.json",
]
PATH_FIXES = {
    WF / "1_图片/K2图像/2_图生图/DynamicCharacterSheet_krea2_v1.json": {
        "krea/krea2_charactersheet_full_v1.safetensors":
            "DynamicCharacterSheet_krea2_v1.safetensors",
    },
}
ALIGN_NAMED = {  # file → {node_id: 取 positional wv[0] 对齐 named.lora_name}
    WF / "2_视频/H3视频/6_社区模板/社区-480P生成-潜空间放大到960P.json": {41},
}


def node_lora_refs(n: dict) -> set[str]:
    vals: list[str] = []
    wv = n.get("widgets_values")
    if isinstance(wv, list):
        vals += [v for v in wv if isinstance(v, str) and v.lower().endswith(".safetensors")]
    if isinstance(wv, dict):
        vals += [v for v in wv.values() if isinstance(v, str) and v.lower().endswith(".safetensors")]
    named = n.get("widgets_values_named")
    if isinstance(named, dict):
        vals += [v for v in named.values() if isinstance(v, str) and v.lower().endswith(".safetensors")]
    return set(vals)


def splice_out(wf: dict, node: dict) -> tuple[int, int, int]:
    """1进1出节点摘除直连;返回 (被摘节点id, 旧in线, 新线id)。"""
    links = {l[0]: l for l in wf["links"]}
    in_link = next((i.get("link") for i in node.get("inputs", [])
                    if i.get("name") == "model" and i.get("link") is not None), None)
    out_links = [lid for o in node.get("outputs", []) for lid in (o.get("links") or [])]
    assert in_link in links and len(out_links) == 1 and out_links[0] in links, \
        f"节点[{node.get('id')}] 接线形态与预期不符: in={in_link} out={out_links}"
    src, dst = links[in_link], links[out_links[0]]
    new_id = wf["last_link_id"] + 1
    wf["links"] = [l for l in wf["links"] if l[0] not in (in_link, out_links[0])]
    wf["links"].append([new_id, src[1], src[2], dst[3], dst[4], src[5]])
    nodes = {n["id"]: n for n in wf["nodes"]}
    for o in nodes[src[1]].get("outputs", []):
        if in_link in (o.get("links") or []):
            o["links"] = [new_id if x == in_link else x for x in o["links"]]
    for i in nodes[dst[3]].get("inputs", []):
        if i.get("link") == out_links[0]:
            i["link"] = new_id
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] != node["id"]]
    wf["last_link_id"] = new_id
    return node["id"], in_link, new_id


def remove_dead(wf: dict) -> list[str]:
    done: list[str] = []
    while True:
        dead = next((n for n in wf["nodes"]
                     if "lora" in str(n.get("type", "")).lower()
                     and node_lora_refs(n) & DEAD_LORAS), None)
        if dead is None:
            return done
        nid, old, new = splice_out(wf, dead)
        done.append(f"节点[{nid}] 摘除(旧线{old}→新线{new} 直连)")


def clean_notes(wf: dict) -> int:
    """MarkdownNote 等字符串 widget 里含死引 token 的整行删除;返回删行数。"""
    removed = 0
    for n in wf["nodes"]:
        wv = n.get("widgets_values")
        if isinstance(wv, list) and wv and isinstance(wv[0], str) and any(m in wv[0] for m in NOTE_MARKS):
            lines = wv[0].split("\n")
            keep = [l for l in lines if not any(m in l for m in NOTE_MARKS)]
            removed += len(lines) - len(keep)
            wv[0] = "\n".join(keep)
        named = n.get("widgets_values_named")
        if isinstance(named, dict) and isinstance(named.get("text"), str) \
                and any(m in named["text"] for m in NOTE_MARKS):
            lines = named["text"].split("\n")
            keep = [l for l in lines if not any(m in l for m in NOTE_MARKS)]
            removed += len(lines) - len(keep)
            named["text"] = "\n".join(keep)
    return removed


def fix_ghost_ids(wf: dict) -> list[str]:
    done: list[str] = []
    for n in wf["nodes"]:
        wv = n.get("widgets_values")
        if isinstance(wv, list):
            for i, v in enumerate(wv):
                if isinstance(v, str):
                    for old, new in GHOST_TEXT_FIXES:
                        if old in v:
                            done.append(f"节点[{n.get('id')}] wv[{i}] 「{old[:18]}…」→「{new[:18]}…」")
                            wv[i] = v = v.replace(old, new)
        named = n.get("widgets_values_named")
        if isinstance(named, dict):
            for k, v in list(named.items()):
                if isinstance(v, str):
                    for old, new in GHOST_TEXT_FIXES:
                        if old in v:
                            done.append(f"节点[{n.get('id')}] named.{k} 「{old[:18]}…」→「{new[:18]}…」")
                            named[k] = v.replace(old, new)
    return done


def apply_path_fixes(wf: dict, fixes: dict[str, str]) -> list[str]:
    done: list[str] = []
    for n in wf["nodes"]:
        wv = n.get("widgets_values")
        if isinstance(wv, list):
            for i, v in enumerate(wv):
                if isinstance(v, str) and v in fixes:
                    done.append(f"节点[{n.get('id')}] wv[{i}] {v} → {fixes[v]}")
                    wv[i] = fixes[v]
        named = n.get("widgets_values_named")
        if isinstance(named, dict):
            for k, v in list(named.items()):
                if isinstance(v, str) and v in fixes:
                    done.append(f"节点[{n.get('id')}] named.{k} {v} → {fixes[v]}")
                    named[k] = fixes[v]
    return done


def align_named(wf: dict, node_ids: set[int]) -> list[str]:
    done: list[str] = []
    for n in wf["nodes"]:
        if n.get("id") not in node_ids:
            continue
        wv, named = n.get("widgets_values"), n.get("widgets_values_named")
        assert isinstance(wv, list) and isinstance(named, dict) and isinstance(wv[0], str), \
            f"节点[{n.get('id')}] 形态与预期不符"
        if named.get("lora_name") != wv[0]:
            done.append(f"节点[{n.get('id')}] named.lora_name {named.get('lora_name')} → {wv[0]}(对齐盘上实名)")
            named["lora_name"] = wv[0]
    return done


def lint_issues(text: str) -> set[str]:
    """对一段 workflow JSON 文本跑 lint,返回问题集合(基线对比用)。"""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     encoding="utf-8") as tf:
        tf.write(text)
        name = tf.name
    try:
        r = subprocess.run([sys.executable, str(LINT), name],
                           capture_output=True, text=True)
        return {l.strip() for l in (r.stdout + r.stderr).splitlines()
                if l.strip().startswith("- ")}
    finally:
        Path(name).unlink(missing_ok=True)


def process(path: Path, is_home: bool) -> None:
    print(f"== {path}")
    if is_home:
        BACKUP.mkdir(parents=True, exist_ok=True)
        bak = BACKUP / path.name
        if not bak.exists():
            shutil.copy2(path, bak)
            print(f"  备份 → {bak}")
    before = path.read_text(encoding="utf-8")
    wf = json.loads(before)
    changed = False
    if path in REMOVE_TARGETS:
        done = remove_dead(wf)
        lines = clean_notes(wf)
        ghosts = fix_ghost_ids(wf)
        if done or lines or ghosts:
            changed = True
            for d in done:
                print(f"  摘除 {d}")
            if lines:
                print(f"  卡文死引行删 {lines} 行")
            for g in ghosts:
                print(f"  幽灵号 {g}")
    if path in PATH_FIXES:
        done = apply_path_fixes(wf, PATH_FIXES[path])
        if done:
            changed = True
            for d in done:
                print(f"  路径 {d}")
    if path in ALIGN_NAMED:
        done = align_named(wf, ALIGN_NAMED[path])
        if done:
            changed = True
            for d in done:
                print(f"  对齐 {d}")
    if not changed:
        print("  幂等跳过(无死引/已修)")
        return
    after = json.dumps(wf, ensure_ascii=False, indent=2)
    base_issues = lint_issues(before)
    new_issues = lint_issues(after) - base_issues
    path.write_text(after, encoding="utf-8")
    if new_issues:
        for i in sorted(new_issues):
            print(f"  ✗ 新增 lint 问题:{i}")
        raise SystemExit(f"lint 新增问题:{path}")
    print(f"  lint 门禁过(改前遗留 {len(base_issues)} 项,零新增)")


def main() -> int:
    for p in REMOVE_TARGETS:
        process(p, is_home=HOME_WF in p.parents)
    for p in list(PATH_FIXES) + list(ALIGN_NAMED):
        process(p, is_home=False)
    print("\n[refclose] 完成。明确未动:K2-文生图-道劫.json(并行会话)、"
          "官方本地-R2V [145](H3 ref2v turbo 不在盘,active,留台账勾选)。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
