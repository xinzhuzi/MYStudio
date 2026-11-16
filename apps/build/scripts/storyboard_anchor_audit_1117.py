#!/usr/bin/env python3
"""分镜剧情锚定三层审计(1117 C2 门C,只读产品化验收脚本)。

输入(全部只读):
  --store      MA store 根(默认 ~/Project/IP/MA/store;含 scenes.json/
               studio-workflow/chapters/<chapter>/ 分片)
  --chapter    章节目录名(默认 chapter-001)
  --diagnostics  可选,诊断 jsonl(漫影工作室 logs/diagnostics/ 下按日文件;
               提供时取「实发 400」=storyboard-canonical-anchors/lint 相关
               与 freedom-image prompt.promptPreview 证据)

输出:每镜 PASS/FAIL/WARN 三层判定——
  层① 400 锚词:实发主体句(promptPreview,缺诊断时按建流图 prompt 节点文)
      含场景名/时辰词族/在场人物名(C2 门A 同口径的离线复算);
  层② 参考槽对账:建流图(image-workflows-*.json)资产参考节点数/名 vs
      分镜行点名资产(associateAssetsNames);引擎 history 缺席时按图侧;
  层③ 建流参考节点集 vs 解析集(名字双向包含对账)。

用法:
  python3 apps/build/scripts/storyboard_anchor_audit_1117.py \
      [--store /path/to/store] [--chapter chapter-001] \
      [--diagnostics /path/to/diagnostics-YYYY-MM-DD.jsonl]

退出码:0=全 PASS/WARN;1=存在 FAIL(供 CI/验收门消费)。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from pathlib import Path

TIME_FAMILIES = {
    "夜": ["夜", "夜晚", "夜间", "夜里", "入夜", "深夜"],
    "日": ["日", "白日", "白天", "正午", "日间"],
    "晨": ["晨", "清晨"],
    "暮": ["暮", "黄昏", "傍晚"],
}
SLUG_TIME_TOKENS = {
    "night": "夜", "day": "日", "noon": "日",
    "dawn": "晨", "morning": "晨", "dusk": "暮", "evening": "暮",
}


def load_json(path: Path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


def load_storyboards(chapter_dir: Path) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(glob.glob(str(chapter_dir / "storyboards-*.json"))):
        data = load_json(Path(path))
        if not data:
            continue
        state = data.get("state", data)
        items = state.get("storyboards") if isinstance(state, dict) else None
        for item in items or []:
            rows.append(item)
    rows.sort(key=lambda item: item.get("index", 0))
    return rows


def load_workflows(chapter_dir: Path) -> dict[str, dict]:
    """target.id=分镜 id → 最新建流图(按文件名排序取末位)。"""
    graphs: dict[str, dict] = {}
    for path in sorted(glob.glob(str(chapter_dir / "image-workflows-*.json"))):
        data = load_json(Path(path))
        if not data:
            continue
        state = data.get("state", data)
        workflows = state.get("imageWorkflows") if isinstance(state, dict) else None
        for graph in workflows or []:
            target = graph.get("target") or {}
            if target.get("kind") == "storyboard":
                graphs[target.get("id", "")] = graph
    return graphs


def load_scene_names(store_root: Path) -> dict[str, str]:
    scenes: dict[str, str] = {}
    data = load_json(store_root / "scenes.json")
    if isinstance(data, dict) and isinstance(data.get("state"), dict):
        # 实测三库 scenes.json={state:{scenes?或以 id 为键的行字典},version}。
        data = data["state"]
    if isinstance(data, dict):
        rows = data.get("scenes") or [v for v in data.values() if isinstance(v, dict)]
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    for row in rows or []:
        if isinstance(row, dict) and row.get("id") and row.get("name"):
            scenes[row["id"]] = row["name"]
    return scenes


def resolve_time_of_day(shot: dict, scene_name: str | None) -> str | None:
    """五源序离线复算(与 storyboard-canonical-context.resolveShotTimeOfDay 同序)。"""
    direct = (shot.get("timeOfDay") or "").strip()
    if direct:
        return direct
    lighting = ((shot.get("continuityState") or {}).get("lighting") or "").strip()
    for family in TIME_FAMILIES.values():
        if any(word in lighting for word in family):
            return family[0]
    slug = ((shot.get("shotSemantics") or {}).get("sceneViewpointId") or "")
    for segment in slug.replace("_", "-").split("-"):
        token = SLUG_TIME_TOKENS.get(segment.lower())
        if token:
            return token
    text = "\n".join(filter(None, [shot.get("videoDesc"), shot.get("prompt")]))
    best_index, best_word = None, None
    for family in TIME_FAMILIES.values():
        for word in family:
            index = text.find(word)
            if index >= 0 and (best_index is None or index < best_index):
                best_index, best_word = index, family[0]
    if best_word:
        return best_word
    if scene_name:
        for family in TIME_FAMILIES.values():
            if any(word in scene_name for word in family):
                return family[0]
    return None


def resolve_scene_name(shot: dict, scene_names_by_id: dict[str, str]) -> str | None:
    """五级序离线复算:id→sceneName→文本探针(三库名 includes)→点名名单。"""
    for asset_id in shot.get("associateAssetsIds") or []:
        if asset_id.startswith("scene_") and asset_id in scene_names_by_id:
            return scene_names_by_id[asset_id]
    scene_field = (shot.get("sceneName") or "").strip()
    if scene_field:
        return scene_field
    text = "\n".join(filter(None, [shot.get("videoDesc"), shot.get("prompt")]))
    hits = [
        name for name in scene_names_by_id.values()
        if len(name) >= 2 and name in text
    ]
    if hits:
        return max(hits, key=len)
    for name in shot.get("associateAssetsNames") or []:
        for scene_name in scene_names_by_id.values():
            if name and (name in scene_name or scene_name in name):
                return scene_name
    return None


def load_sent_prompts(diagnostics_path: Path | None) -> list[str]:
    """诊断 jsonl → 实发 400 证据池(HTTP request completed 的 prompt.promptPreview)。

    该类条目不带 shotId(实测 context 键:endpointFamily/…/prompt),镜级归因
    由 audit 侧按锚词(主角名+场景名)在证据池内匹配——匹配面保守(锚词全中
    才认),宁可标 none 不冒充。
    """
    sent: list[str] = []
    if not diagnostics_path or not diagnostics_path.exists():
        return sent
    with open(diagnostics_path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or "promptPreview" not in line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            context = entry.get("context") or {}
            prompt_field = context.get("prompt") if isinstance(context, dict) else None
            if isinstance(prompt_field, dict) and isinstance(prompt_field.get("promptPreview"), str):
                preview = prompt_field["promptPreview"]
                if preview.startswith("绘制一张全新的单格剧情画面"):
                    sent.append(preview)
    return sent


def match_sent_prompt(pool: list[str], protagonist: str | None, scene_name: str | None) -> str | None:
    """证据池内按锚词归因:主角名+场景基础名全中才认(保守)。"""
    base_scene = (scene_name or "").split("·")[0]
    for preview in reversed(pool):
        if protagonist and protagonist in preview:
            if not base_scene or base_scene in preview:
                return preview
    return None


def audit_shot(shot: dict, graph: dict | None, prompt_pool: list[str],
               scene_names_by_id: dict[str, str]) -> dict:
    shot_id = shot.get("id", "?")
    index = shot.get("index", 0)
    scene_name = resolve_scene_name(shot, scene_names_by_id)
    base_scene = (scene_name or "").split("·")[0]
    time_word = resolve_time_of_day(shot, scene_name)
    semantics = shot.get("shotSemantics") or {}
    visible = [c.get("name", "") for c in semantics.get("visibleCharacters") or []]
    named = list(shot.get("associateAssetsNames") or [])
    protagonist = visible[0] if visible else (named[0] if named else None)

    # 实发 400:诊断实发(锚词归因) > 建流图 prompt 节点文。
    graph_prompt = None
    if graph:
        for node in graph.get("nodes") or []:
            if node.get("type") == "prompt" and isinstance(node.get("text"), str) and node["text"].strip():
                graph_prompt = node["text"]
    sent_prompt = match_sent_prompt(prompt_pool, protagonist, scene_name)
    prompt_text = sent_prompt or graph_prompt or ""
    prompt_source = "diagnostics" if sent_prompt else ("graph" if graph_prompt else "none")

    failures: list[str] = []
    warns: list[str] = []
    if prompt_text:
        if scene_name and scene_name not in prompt_text and base_scene not in prompt_text:
            failures.append(f"层①400缺场景名「{scene_name}」")
        if not scene_name:
            warns.append("层①场景五级序未解析(锚缺席)")
        if time_word:
            family = TIME_FAMILIES.get(time_word, [time_word])
            if not any(word in prompt_text for word in family):
                failures.append(f"层①400缺时辰词族「{time_word}」")
        else:
            warns.append("层①时辰五源序未解析(锚缺席)")
        for name in visible:
            if name and name not in prompt_text:
                warns.append(f"层①400缺在场人物「{name}」(软)")
    else:
        warns.append("层①无实发400证据(诊断与建流图均缺)")

    # 层②/③:建流图资产参考节点(有边入成图者)vs 点名资产——图内孤儿节点
    # (复用/补挂历史残留)不计槽位,与传输层 extractCanonicalSlotSources 同口径。
    if graph:
        generated_ids = {n.get("id") for n in graph.get("nodes") or [] if n.get("type") == "generated"}
        edge_sources = {
            e.get("source") for e in graph.get("edges") or []
            if e.get("target") in generated_ids
        }
        ref_nodes = [
            node for node in graph.get("nodes") or []
            if node.get("type") == "reference"
            and (node.get("source") or {}).get("kind") == "asset"
            and node.get("id") in edge_sources
        ]
        ref_titles = [node.get("title", "") for node in ref_nodes]
        character_refs = [node.get("title", "") for node in ref_nodes
                          if (node.get("source") or {}).get("assetType") == "character"]
        for name in visible:
            if name and not any(name in title or title in name for title in character_refs):
                warns.append(f"层③在场人物「{name}」无角色参考节点(off-frame 或未挂)")
        scene_refs = [t for t in ref_titles if scene_name and (scene_name in t or base_scene in t)]
        if scene_name and not scene_refs:
            warns.append(f"层②场景「{base_scene}」无场景参考节点(无图/断链)")
        # 点名资产(角色向) vs 参考节点:点名而零节点者逐条对账。
        for name in named:
            if not any(name in title or title in name for title in ref_titles):
                warns.append(f"层③点名资产「{name}」无参考节点(道具§4.5恒不入槽属正常)")
        slot_count = len([n for n in ref_nodes
                          if (n.get("source") or {}).get("assetType") in ("character", "scene")])
        if slot_count > 3:
            # §4.5 槽映射恒 ≤3(超额进 dropped 带 reason),图内>3=复用残留,
            # 属可观测态非传输违规——WARN 不 FAIL。
            warns.append(f"层②入槽候选参考节点 {slot_count} 个>3(§4.5 映射时超额入 dropped)")
    else:
        warns.append("层②③无建流图分片(未建流/已清理)")

    status = "FAIL" if failures else ("WARN" if warns else "PASS")
    return {
        "shot": f"S{index:02d}", "shotId": shot_id, "status": status,
        "scene": scene_name, "time": time_word,
        "visible": visible, "promptSource": prompt_source,
        "failures": failures, "warnings": warns,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="分镜剧情锚定三层审计(1117 C2 门C)")
    parser.add_argument("--store", default=os.path.expanduser("~/Project/IP/MA/store"))
    parser.add_argument("--chapter", default="chapter-001")
    parser.add_argument("--diagnostics", default=None)
    args = parser.parse_args()

    store_root = Path(args.store)
    chapter_dir = store_root / "studio-workflow" / "chapters" / args.chapter
    if not chapter_dir.exists():
        print(f"[门C] 章节目录不存在: {chapter_dir}", file=sys.stderr)
        return 1
    scene_names_by_id = load_scene_names(store_root)
    storyboards = load_storyboards(chapter_dir)
    if not storyboards:
        print(f"[门C] 无分镜分片: {chapter_dir}/storyboards-*.json", file=sys.stderr)
        return 1
    workflows = load_workflows(chapter_dir)
    diagnostics_path = Path(args.diagnostics).expanduser() if args.diagnostics else None
    prompt_pool = load_sent_prompts(diagnostics_path)

    results = [
        audit_shot(shot, workflows.get(shot.get("id", "")), prompt_pool, scene_names_by_id)
        for shot in storyboards
    ]
    pass_count = sum(1 for r in results if r["status"] == "PASS")
    warn_count = sum(1 for r in results if r["status"] == "WARN")
    fail_count = sum(1 for r in results if r["status"] == "FAIL")
    for r in results:
        line = f"[{r['status']}] {r['shot']} {r['shotId']} 场景={r['scene'] or '—'} 时辰={r['time'] or '—'} 400源={r['promptSource']}"
        print(line)
        for failure in r["failures"]:
            print(f"    FAIL {failure}")
        for warning in r["warnings"]:
            print(f"    WARN {warning}")
    print(f"\n[门C] {args.chapter}: PASS={pass_count} WARN={warn_count} FAIL={fail_count}"
          f"(镜数={len(results)};诊断实发证据池={len(prompt_pool)})")
    return 1 if fail_count else 0


if __name__ == "__main__":
    sys.exit(main())
