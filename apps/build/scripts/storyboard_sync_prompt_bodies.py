#!/usr/bin/env python3
"""工作流 prompt 正文与当前分镜同步(08-24 审计 F 维度补漏)。

背景: 6 月代 storyboard-flow 的 prompt 正文是旧表画面(部分为「@图N 内联」
残缺格式),参考重建/指纹盖章不会自动换正文——批量生图按残缺正文出图,
内容与当前分镜脱节(S20-23 空街缺人物实证)。

逻辑: 择优流 prompt 节点正文若不含当前 videoDesc 前 12 字 → 重建正文
  @图N 头段(现参考序,保留) + 【画面】<当前 videoDesc> + 【台词语境】<lines>
  + 视觉手册风格锁尾段;negativePrompt 原样保留;gen 节点 prompt 同步。
sb 不动 → 指纹不变。幂等:已同步自动跳过。

用法: python3 storyboard_sync_prompt_bodies.py [--apply]   # 默认 dry-run
前置: 应用未运行。
"""
from __future__ import annotations
import json
import shutil
import sys
import time
from pathlib import Path

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")

MANUAL = Path(__file__).resolve().parents[2] / (
    "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
    "/art_prompt/art_storyboard_video.md"
)


def _manual_block(name: str) -> str:
    """读手册标记块(08-28 无色根修:尾段跟手册演化,勿再硬编码 token)。"""
    text = MANUAL.read_text(encoding="utf-8")
    match = __import__("re").search(
        rf"<!-- {name}:start -->\n?([\s\S]*?)<!-- {name}:end -->", text
    )
    if not match or not match.group(1).strip():
        raise SystemExit(f"手册标记块 {name} 缺失: {MANUAL}")
    return match.group(1).strip()


STYLE_TAIL = ", " + ", ".join(
    line.strip() for line in _manual_block("storyboard-image-style-tokens").splitlines() if line.strip()
)
KIND_LABEL = {"scene": "场景", "character": "角色", "prop": "道具"}


def main() -> None:
    apply = "--apply" in sys.argv
    man = json.loads((STORE / "manifest.json").read_text())
    shards = {rel: json.loads((STORE / rel).read_text()) for rel in man["shards"]}
    sbs, wfs = {}, {}
    for rel, doc in shards.items():
        st = doc.get("state", {})
        for sb in st.get("storyboards") or []:
            sbs[sb.get("id")] = (rel, sb)
        for wf in st.get("imageWorkflows") or []:
            wfs[wf.get("id")] = (rel, wf)

    touched: set[str] = set()
    notes = []
    ts = int(time.time() * 1000)
    for sid, (rel, sb) in sorted(sbs.items(), key=lambda kv: kv[1][1].get("index") or 0):
        idx = sb.get("index")
        wid = sb.get("imageWorkflowId")
        if wid not in wfs:
            continue
        wrel, wf = wfs[wid]
        vd = (sb.get("videoDesc") or "").strip()
        key = vd[:12] if len(vd) >= 12 else vd
        if not key:
            continue
        # 找主 prompt 节点(targetNodeId 指向主成图者优先)
        nodes = wf.get("nodes", [])
        main_gen = next((n for n in nodes if n.get("type") == "generated"
                         and "背景板" not in (n.get("title") or "") and "净底" not in (n.get("title") or "")), None)
        prompts = [n for n in nodes if n.get("type") == "prompt"]
        main_prompt = next((p for p in prompts if p.get("targetNodeId") == (main_gen or {}).get("id")), prompts[0] if prompts else None)
        if main_prompt is None:
            continue
        body = main_prompt.get("prompt") or ""
        if key in body:
            continue
        # 头段保留: 现有 @图N 行(到首个【前)
        hstart = body.find("@图1")
        bstart = body.find("【")
        head = body[hstart:bstart].strip() if (hstart >= 0 and bstart > hstart) else ""
        # 重建正文
        parts = [f"【画面】{vd}"]
        if sb.get("lines"):
            parts.append(f"【台词语境】{sb['lines']}")
        new_body = ("\n".join(parts) + STYLE_TAIL)
        new_prompt = (head + "\n" + new_body) if head else new_body
        main_prompt["prompt"] = new_prompt
        main_prompt["updatedAt"] = ts
        # gen 节点同步
        if main_gen:
            main_gen["prompt"] = new_prompt
            main_gen["updatedAt"] = ts
        wf["updatedAt"] = ts
        touched.add(wrel)
        notes.append(f"S{idx}: 正文重建(head={'有' if head else '无'}) ← videoDesc[{vd[:18]}…]")

    print(f"正文同步计划: {len(notes)} 镜, 触及 {len(touched)} 分片")
    for n in notes:
        print(" ", n)
    if not apply:
        print("dry-run(未写盘)。--apply 执行。")
        return
    bak = STORE.parent / f"studio-workflow.bak-bodysync-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copytree(STORE, bak)
    print(f"快照: {bak}")
    for rel in sorted(touched):
        (STORE / rel).write_text(json.dumps(shards[rel], ensure_ascii=False, indent=2) + "\n")
        print(f"写盘: {rel}")


if __name__ == "__main__":
    main()
