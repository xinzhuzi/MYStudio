#!/usr/bin/env python3
"""内容过滤软化修复(08-24 审计:9 镜生图被上游暴力/儿童安全过滤拒绝)。

对被拒镜做画面语义不变的措辞软化(断臂→独臂/渗血→暗色印痕/孩童危险动作→
掠过·落在 等),同步三处: sb.videoDesc+prompt、流 prompt/gen 节点正文、
指纹(stableHash 字节级复刻=递归键排序 JSON,重盖 sb.sourceFingerprint 与
流 targetSourceFingerprint)。

用法: python3 storyboard_soften_prompts.py [--apply]   # 默认 dry-run
前置: 应用未运行。
"""
from __future__ import annotations
import json
import shutil
import sys
import time
from pathlib import Path

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")

SOFTEN = {
    14: (
        "当铺高柜下，一名断臂散修用仅剩的手拍击柜面，伤处白布持续渗血，掌中紧攥半株凝血草；管事垂眼拨动算盘。",
        "当铺高柜下，一名独臂散修用仅剩的手按住柜面，臂端白布透出暗色印痕，掌中紧攥半株草药；管事垂眼拨动算盘。",
    ),
    17: (
        "断臂散修攥紧凝血草，伤处白布持续渗血；独孤剑尘从柜台外经过，脚步因争执短暂停住。",
        "独臂散修攥紧一株草药，臂端白布透出暗色印痕；独孤剑尘从柜台外经过，脚步因争执短暂停住。",
    ),
    32: (
        "独孤剑尘捏紧白土笔，笔杆在虎口剑茧处折成两截；灰末落在掌纹上，他用剩余半截在门板旧痕下补下一笔。",
        "独孤剑尘捏紧白土笔，笔杆在虎口剑茧处应声断开；灰末落在掌纹上，他用剩余半截在门板旧痕下补下一笔。",
    ),
    35: (
        "独孤剑尘掌心贴上男孩后背，沿肩胛缓慢向下压；男孩紧耸的肩头逐渐放松。",
        "独孤剑尘在男孩身后俯身示范，手掌悬于其肩背上方缓缓下引；男孩紧耸的肩头逐渐放松。",
    ),
    36: (
        "前排男孩仰头询问，独孤剑尘仍保持蹲姿，手掌从男孩后背收回，停在自己腹前。",
        "前排男孩仰头询问，独孤剑尘仍保持蹲姿，手从半空收回，停在自己腹前。",
    ),
    40: (
        "小杂役抱着高过头顶的柴捆跨入门框，脚尖撞上门槛后身体前倾；最上方木段脱出，旋向前排捡竹筹的孩童。",
        "小杂役抱着高过头顶的柴捆跨入门框，脚尖磕到门槛，身形一晃；最上方木段滑脱，掠向前排孩童拣竹筹的桌案边。",
    ),
    41: (
        "独孤剑尘右脚向前半寸，鞋尖贴住木段中部；木段在半空横转，擦过前排孩童发顶后砸向地面。",
        "独孤剑尘右脚向前半寸，鞋尖贴住木段中部；木段在半空横转，贴着前排孩童发顶上方掠过，落在地面。",
    ),
    42: (
        "前排孩童抱头蹲成一团，木段停在她后方一掌处；小杂役跪在门槛边，双手抱住散开的劈柴，神情慌乱。",
        "前排孩童们缩肩低头聚在一处，木段停在她身后一掌远的地面；小杂役跪在门槛边，双手拢住散开的木柴，神情无措。",
    ),
    43: (
        "管事用竹筹指向柴房方向；小杂役连忙把散落木段重新抱起，低头退出危险通道。",
        "管事用竹筹指向柴房方向；小杂役连忙把散落木段重新拢起，低头退到廊边。",
    ),
}


def stable_hash(value) -> str:
    """字节级复刻 TS stableHash: JSON.stringify + 递归(含根)键排序,undefined 属性丢弃。"""
    def norm(v):
        if isinstance(v, dict):
            out = {}
            for k in sorted(v):
                if v[k] is None:
                    continue  # JSON.stringify 丢弃 undefined
                out[k] = norm(v[k])
            return out
        if isinstance(v, list):
            return [norm(x) for x in v]
        return v
    return json.dumps(norm(value), ensure_ascii=False, separators=(",", ":"))


def sb_fingerprint(sb: dict) -> str:
    cs = sb.get("continuityState")
    return stable_hash({
        "episodeId": sb.get("episodeId"),
        "index": sb.get("index"),
        "trackKey": sb.get("trackKey"),
        "duration": sb.get("duration"),
        "prompt": sb.get("prompt"),
        "videoDesc": sb.get("videoDesc"),
        "assetIds": sb.get("assetIds") or [],
        "shouldGenerateImage": sb.get("shouldGenerateImage"),
        "orderedReferenceManifest": sb.get("orderedReferenceManifest") or [],
        "shotSemantics": sb.get("shotSemantics"),
        "cinematic": sb.get("cinematic"),
        "continuityState": ({**cs, "inputFingerprint": None} if cs else None),
        "lines": sb.get("lines"),
        "speakerId": sb.get("speakerId"),
    })


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
    for sid, (rel, sb) in sbs.items():
        idx = sb.get("index")
        if idx not in SOFTEN:
            continue
        old, new = SOFTEN[idx]
        if sb.get("videoDesc") != old:
            notes.append(f"S{idx}: ⚠️ videoDesc 与预期原文不符,跳过(需人工核)")
            continue
        sb["videoDesc"] = new
        if sb.get("prompt") == old:
            sb["prompt"] = new
        fp = sb_fingerprint(sb)
        sb["sourceFingerprint"] = fp
        touched.add(rel)
        notes.append(f"S{idx}: 软化+指纹重算")
        wid = sb.get("imageWorkflowId")
        if wid in wfs:
            wrel, wf = wfs[wid]
            for n in wf.get("nodes", []):
                p = n.get("prompt")
                if isinstance(p, str) and old in p:
                    n["prompt"] = p.replace(old, new)
                    n["updatedAt"] = int(time.time() * 1000)
            wf["targetSourceFingerprint"] = fp
            wf["updatedAt"] = int(time.time() * 1000)
            touched.add(wrel)
            notes.append(f"S{idx}: 流 {wid[:26]} 正文替换+指纹重盖")

    print(f"软化计划: {len(notes)} 步, 触及 {len(touched)} 分片")
    for n in notes:
        print(" ", n)
    if not apply:
        print("dry-run(未写盘)。--apply 执行。")
        return
    bak = STORE.parent / f"studio-workflow.bak-soften-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copytree(STORE, bak)
    print(f"快照: {bak}")
    for rel in sorted(touched):
        (STORE / rel).write_text(json.dumps(shards[rel], ensure_ascii=False, indent=2) + "\n")
        print(f"写盘: {rel}")


if __name__ == "__main__":
    main()
