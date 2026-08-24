#!/usr/bin/env python3
"""道劫分镜审计修复链(08-24 六维度审计落地,可复跑)。

前置:应用必须未运行(分片增量写轮换,离线写才安全);--apply 时自动整目录快照。

修复内容(每步幂等,已达标自动跳过):
  1 名单: 移除悬空名「灵矿」(库内仅空白记录占位);S41+丫头、S14/15/17+凝血草 补名单
  2 择优: 每镜保留一条胜者流,删除败者(6月旧 storyboard-flow / r0 空参考流)
     胜者规则: mediaRef.path 所属流 > mediaRef.id 流 > 指纹对齐流(fp=Y 且参考≥1)
  3 参考重建: 胜者流按产品口径(场景≤1+画面内角色≤3,道具不挂)重建参考节点,
     @图N 头段按 continuityOrder 重写(ensureStoryboardBindingConsistency 同款)
  4 重绑: sb/mediaRef 的 imageWorkflowId+nodeId → 胜者流+主成图节点
  5 盖章: 胜者流 targetSourceFingerprint = sb.sourceFingerprint(直拷)
  6 建流: legacy 直出且无流的 14 镜,按 image-flow 模板全形状离线建流
     (gen.resultUrl=legacy 文件,status=ready;参考/提示词同口径装配)

用法: python3 storyboard_repair_chain.py [--apply]   # 默认 dry-run 打印计划
"""
from __future__ import annotations
import json
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")
ASSETS = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets")
DB = ASSETS / "assets.db"
PID = "49dce4c1-64b1-42de-85c2-9f266698aec4"

STYLE_TAIL = (
    ", Chinese ink wash painting style, xianxia immortal cultivation, traditional brushwork, "
    "restrained mineral-color palette, smooth pale matte flat-wash ground, "
    "工笔线描，写意晕染，浅净平涂底，墨色层次丰富, clear layered ink-wash composition, "
    "atmospheric depth, crisp gongbi linework throughout, clean finished gongbi quality"
)
NEGATIVE = (
    "photorealistic photography, 3D render, CGI, cel shading, anime style, western oil painting, "
    "western fantasy, cyberpunk, sci-fi, high saturation neon, three-point Hollywood lighting, "
    "heavy cinematic rim light, paper-wrinkle texture, crumpled-sheet folds, wave-like surface "
    "ripples, fiber streaks, pulp grain mesh, scanned-paper filter, yellowed aged sheet, "
    "full-frame paper texture, AI muddy noise, dirty texture, compression artifacts, "
    "oversharpening halos, low quality, blurry, messy ink, broken linework, bad anatomy, "
    "extra limbs, weapon passing through body, unstable stance, text, watermark, logo, subtitle, "
    "webtoon cover beauty portrait, idol poster, tattered clothing, ragged hems"
)
KIND_LABEL = {"scene": "场景", "character": "角色", "prop": "道具"}
PREFIXES = ("监工", "管事", "老", "年轻", "小", "断臂")

NAME_REMOVE = {"灵矿"}
NAME_ADD = {41: ["丫头"], 14: ["凝血草"], 15: ["凝血草"], 17: ["凝血草"]}


def rand6() -> str:
    import random
    import string
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


def now_ms() -> int:
    return int(time.time() * 1000)


def load_all():
    man = json.loads((STORE / "manifest.json").read_text())
    shards = {}  # rel path -> parsed doc
    for rel in man["shards"]:
        p = STORE / rel
        if p.is_file():
            shards[rel] = json.loads(p.read_text())
    return man, shards


def collect(shards):
    sbs, wfs = {}, {}  # id -> (rel_path, obj)
    for rel, doc in shards.items():
        st = doc.get("state", {})
        for sb in st.get("storyboards") or []:
            sbs[sb.get("id")] = (rel, sb)
        for wf in st.get("imageWorkflows") or []:
            wfs[wf.get("id")] = (rel, wf)
    return sbs, wfs


def main() -> None:
    apply = "--apply" in sys.argv
    man, shards = load_all()
    sbs, wfs = collect(shards)
    con = sqlite3.connect(str(DB))
    db = {}  # name -> (id, type, filePath) 精确名
    for aid, atype, name, fp in con.execute("SELECT id, type, name, filePath FROM assets"):
        db.setdefault(name, (aid, atype, fp))
    all_names = list(db)

    def resolve_asset(n):
        """精确名优先;唯一模糊命中才采用(batchMatch 语义)。"""
        if n in db:
            return db[n]
        hits = [m for m in all_names if n in m or m in n]
        return db[hits[0]] if len(hits) == 1 else None

    def db_key(aid):
        for k, v in db.items():
            if v[0] == aid:
                return k
        return aid

    by_target: dict[str, list[str]] = {}
    for wid, (rel, wf) in wfs.items():
        t = wf.get("target") or {}
        if t.get("kind") == "storyboard":
            by_target.setdefault(t.get("id"), []).append(wid)

    plan: list[str] = []
    touched_shards: set[str] = set()
    deleted_wfs: set[str] = set()

    def note(msg: str) -> None:
        plan.append(msg)

    def is_main_gen(n) -> bool:
        return n.get("type") == "generated" and "背景板" not in (n.get("title") or "") and "净底" not in (n.get("title") or "")

    def asset_file_url(fp: str) -> str:
        return "asset-file://" + quote(fp, safe="/-._~")

    def frame_of(sb):
        return ((sb.get("videoDesc") or "") + (sb.get("prompt") or "") + (sb.get("lines") or ""))

    def visible_chars(sb):
        sem = sb.get("shotSemantics") or {}
        names = []
        for c in sem.get("visibleCharacters") or []:
            if isinstance(c, dict) and c.get("name"):
                names.append(c["name"])
        return names

    def role_in_frame(name, sb):
        vis = visible_chars(sb)
        for v in vis:
            if name == v:
                return True
            for p in PREFIXES:
                if (name.startswith(p) and name[len(p):] == v) or (v.startswith(p) and v[len(p):] == name):
                    return True
        frame = frame_of(sb)
        if name in frame:
            return True
        for p in PREFIXES:
            if name.startswith(p) and len(name) > len(p) + 1 and name[len(p):] in frame:
                return True
        return False

    def canonical_refs(sb):
        """产品口径: 场景≤1(名单序首命中且库内有图) + 画面内角色≤3(名单序)。"""
        names = [n for n in (sb.get("associateAssetsNames") or []) if n]
        out = []
        for n in names:
            row = resolve_asset(n)
            if not row:
                continue
            aid, atype, fp = row
            if atype == "scene" and fp and (ASSETS / "files" / fp).is_file():
                out.append({"title": db_key(aid), "assetId": aid, "assetType": "scene", "filePath": fp})
                break
        for n in names:
            row = resolve_asset(n)
            if not row:
                continue
            aid, atype, fp = row
            if atype == "role" and role_in_frame(n, sb) and fp and (ASSETS / "files" / fp).is_file():
                out.append({"title": db_key(aid), "assetId": aid, "assetType": "character", "filePath": fp})
                if sum(1 for r in out if r["assetType"] == "character") >= 3:
                    break
        return out

    def rebuild_refs(wf, sb, refs, ts):
        """重建资产参考节点+edges+@图N 头段(镜像 ensureStoryboardBindingConsistency)。
        保留 source.kind!='asset' 的续镜参考(当前分镜参考图),排资产参考之后。"""
        scoped = [n for n in wf.get("nodes", [])
                  if n.get("type") == "reference" and (n.get("source") or {}).get("kind") != "asset"]
        scoped_ids = {n["id"] for n in scoped}
        nodes = [n for n in wf.get("nodes", []) if n.get("type") != "reference"]
        edges = [e for e in wf.get("edges", [])
                 if e.get("source") not in {n["id"] for n in wf.get("nodes", [])
                                            if n.get("type") == "reference" and n["id"] not in scoped_ids}]
        main_gen = next((n for n in nodes if is_main_gen(n)), None)
        ordered = []
        for i, r in enumerate(refs, start=1):
            nid = f"asset-ref-{ts}-{rand6()}"
            ordered.append({
                "id": nid, "type": "reference", "title": r["title"],
                "imageUrl": asset_file_url(r["filePath"]),
                "position": {"x": 80, "y": 100 + (i - 1) * 180},
                "source": {"kind": "asset", "assetType": r["assetType"], "id": r["assetId"]},
                "continuityOrder": i, "createdAt": ts, "updatedAt": ts,
            })
            if main_gen:
                edges.append({"id": f"{nid}->{main_gen['id']}", "source": nid, "target": main_gen["id"]})
        for j, sn in enumerate(scoped, start=len(refs) + 1):
            sn["continuityOrder"] = j
            sn["updatedAt"] = ts
            ordered.append(sn)
        head = "；".join(
            f"@图{i} 为{r['title']}{KIND_LABEL.get((r.get('source') or {}).get('assetType') or '', '')}"
            for i, r in enumerate(ordered, start=1)
        )
        for n in nodes:
            if n.get("type") in ("prompt", "generated") and head:
                old = n.get("prompt") or ""
                bstart = old.find("【")
                body = old[bstart:] if bstart >= 0 else old.strip()
                if body:
                    n["prompt"] = f"{head}\n{body}"
        wf["nodes"] = ordered + nodes
        wf["edges"] = edges
        wf["updatedAt"] = ts

    for sid in sorted(sbs, key=lambda x: int(x.rsplit("-", 1)[-1])):
        rel, sb = sbs[sid]
        idx = sb.get("index")
        mr = sb.get("mediaRef") or {}
        flows = by_target.get(sid, [])

        # ---- 1 名单 ----
        names = sb.get("associateAssetsNames") or []
        drop = [n for n in names if n in NAME_REMOVE]
        add = [n for n in NAME_ADD.get(idx, []) if n not in names]
        if drop or add:
            sb["associateAssetsNames"] = [n for n in names if n not in NAME_REMOVE] + add
            note(f"S{idx}: 名单 -{drop} +{add}")
            touched_shards.add(rel)

        # ---- 2 择优 ----
        winner = None
        path_flow = None
        mp = unquote(mr.get("path") or "")
        m = re.search(r"workflow-images/[^/]+/([^/]+)/", mp)
        if m:
            path_flow = m.group(1)
        if path_flow and path_flow in flows:
            winner = path_flow
        elif mr.get("kind") == "image" and re.search(r"sb-chapter-\d+-\d+-image\.\w+$", mp):
            # legacy 直出:胜者=主成图 resultUrl 与 mediaRef.path 一致的流;
            # 不一致时取最新流并 heal 其 resultUrl→mediaRef.path(08-23 heal 同语义,
            # mediaRef.path 是时间线渲染真源)
            best, best_ts = None, 0
            for w in flows:
                for n in wfs[w][1].get("nodes", []):
                    if is_main_gen(n) and unquote(n.get("resultUrl") or "") == mp:
                        best = w
                        break
                if best:
                    break
                u = wfs[w][1].get("updatedAt") or 0
                if u > best_ts:
                    best, best_ts = w, u
            winner = best
            if winner and all(
                unquote(n.get("resultUrl") or "") != mp
                for n in wfs[winner][1].get("nodes", []) if is_main_gen(n)
            ):
                for n in wfs[winner][1].get("nodes", []):
                    if is_main_gen(n):
                        n["resultUrl"] = mr.get("path")
                        n["updatedAt"] = now_ms()
                        note(f"S{idx}: heal 主成图 resultUrl→legacy 文件")
                        touched_shards.add(wfs[winner][0])
        elif mr.get("imageWorkflowId") in flows:
            winner = mr["imageWorkflowId"]
        elif mr.get("kind") != "image":
            # 未生成:指纹对齐且参考≥1优先,否则指纹对齐,否则唯一流
            fp = sb.get("sourceFingerprint")
            cands = [w for w in flows if wfs[w][1].get("targetSourceFingerprint") == fp]
            with_refs = [w for w in cands if any(n.get("type") == "reference" for n in wfs[w][1].get("nodes", []))]
            winner = (with_refs or cands or flows or [None])[0]

        if winner is None:
            if flows:
                note(f"S{idx}: ⚠️ 无法择优且有 {len(flows)} 流,跳过(不动)")
            continue
        losers = [w for w in flows if w != winner]
        for lw in losers:
            deleted_wfs.add(lw)
            note(f"S{idx}: 删败者流 {lw}")
            touched_shards.add(wfs[lw][0])
        note(f"S{idx}: 胜者={winner}")

        wrel, wf = wfs[winner]

        # ---- 3 参考重建(仅当缺口内参考或参考跨代) ----
        want = canonical_refs(sb)
        want_titles = [r["title"] for r in want]
        cur_refs = [n for n in wf.get("nodes", []) if n.get("type") == "reference"]
        cur_titles = [(n.get("title") or "").replace("·分层", "") for n in cur_refs
                      if (n.get("source") or {}).get("kind") == "asset"]
        names_set = set(sb.get("associateAssetsNames") or [])
        misaligned = [t for t in cur_titles if t and t not in names_set
                      and not any(t in n2 or n2 in t for n2 in names_set)]
        missing = [t for t in want_titles if t not in cur_titles and not any(t in ct or ct in t for ct in cur_titles)]
        if misaligned or missing or (want and not cur_refs):
            ts = now_ms()
            rebuild_refs(wf, sb, want, ts)
            note(f"S{idx}: 参考重建 {want_titles} (弃 {cur_titles})")
            touched_shards.add(wrel)

        # ---- 5 盖章 ----
        if wf.get("targetSourceFingerprint") != sb.get("sourceFingerprint"):
            wf["targetSourceFingerprint"] = sb.get("sourceFingerprint")
            wf["updatedAt"] = now_ms()
            note(f"S{idx}: 盖指纹章")
            touched_shards.add(wrel)

        # ---- 4 重绑 ----
        main_gen = next((n for n in wf.get("nodes", []) if is_main_gen(n)), None)
        if mr.get("kind") == "image" and (mr.get("imageWorkflowId") != winner
                                          or sb.get("imageWorkflowId") != winner
                                          or mr.get("imageWorkflowNodeId") != (main_gen or {}).get("id")):
            mr["imageWorkflowId"] = winner
            mr["imageWorkflowNodeId"] = (main_gen or {}).get("id")
            sb["imageWorkflowId"] = winner
            sb["imageWorkflowNodeId"] = (main_gen or {}).get("id")
            note(f"S{idx}: 重绑 id→{winner[:30]}")
            touched_shards.add(rel)
            touched_shards.add(wrel)
        elif mr.get("kind") != "image" and sb.get("imageWorkflowId") != winner:
            sb["imageWorkflowId"] = winner
            note(f"S{idx}: 预绑 sb.imageWorkflowId")
            touched_shards.add(rel)

    # ---- 6 建流(legacy 直出无流) ----
    ts = now_ms()
    wf_shard_rel = None
    for rel in shards:
        if "image-workflows" in rel:
            wf_shard_rel = rel  # 取最后一个 wf 分片追加
    for sid in sorted(sbs, key=lambda x: int(x.rsplit("-", 1)[-1])):
        rel, sb = sbs[sid]
        idx = sb.get("index")
        mr = sb.get("mediaRef") or {}
        mp = unquote(mr.get("path") or "")
        if not (mr.get("kind") == "image" and re.search(r"sb-chapter-\d+-\d+-image\.\w+$", mp)):
            continue
        if by_target.get(sid):
            continue  # 已有流(重绑逻辑已覆盖)
        refs = canonical_refs(sb)
        wid = f"image-flow-{ts}-{rand6()}"
        gen_id = f"gen-{ts}-{rand6()}"
        prompt_id = f"prompt-{ts}-{rand6()}"
        head = "；".join(f"@图{i} 为{r['title']}{KIND_LABEL[r['assetType']]}" for i, r in enumerate(refs, start=1))
        body_parts = []
        frame = sb.get("videoDesc") or sb.get("prompt") or ""
        if frame:
            body_parts.append(f"【画面】{frame}")
        if sb.get("lines"):
            body_parts.append(f"【台词语境】{sb['lines']}")
        body = ("\n".join(body_parts) + STYLE_TAIL) if body_parts else STYLE_TAIL.lstrip(", ")
        prompt_text = (head + "\n" + body) if head else body
        try:
            mtime = int((resolve_legacy(mp)).stat().st_mtime * 1000)
        except OSError:
            mtime = ts
        nodes = []
        edges = []
        for i, r in enumerate(refs, start=1):
            nid = f"asset-ref-{ts}-{rand6()}"
            nodes.append({
                "id": nid, "type": "reference", "title": r["title"],
                "imageUrl": asset_file_url(r["filePath"]),
                "position": {"x": 80, "y": 100 + (i - 1) * 180},
                "source": {"kind": "asset", "assetType": r["assetType"], "id": r["assetId"]},
                "continuityOrder": i, "createdAt": ts, "updatedAt": ts,
            })
            edges.append({"id": f"{nid}->{gen_id}", "source": nid, "target": gen_id})
        edges.append({"id": f"{prompt_id}->{gen_id}", "source": prompt_id, "target": gen_id})
        real_nodes = nodes + [
            {
                "id": gen_id, "type": "generated", "title": f"分镜 {idx} 成图",
                "prompt": prompt_text, "aspectRatio": "1:1", "quality": "standard",
                "position": {"x": 627, "y": 120}, "status": "ready",
                "createdAt": ts, "updatedAt": ts,
                "resultUrl": mr.get("path"), "generatedAt": mtime,
            },
            {
                "id": prompt_id, "type": "prompt", "title": "gpt-image-2",
                "prompt": prompt_text, "negativePrompt": NEGATIVE,
                "aspectRatio": "1:1", "quality": "standard", "resolution": "1K",
                "targetNodeId": gen_id, "position": {"x": 629, "y": 597},
                "createdAt": ts, "updatedAt": ts,
            },
        ]
        wf_doc = {
            "id": wid, "name": f"道劫 · 分镜 {idx} 图片工作流",
            "target": {"kind": "storyboard", "id": sid},
            "nodes": real_nodes, "edges": edges,
            "createdAt": ts, "updatedAt": ts,
            "targetSourceFingerprint": sb.get("sourceFingerprint"),
        }
        shards[wf_shard_rel]["state"].setdefault("imageWorkflows", []).append(wf_doc)
        mr["imageWorkflowId"] = wid
        mr["imageWorkflowNodeId"] = gen_id
        sb["imageWorkflowId"] = wid
        sb["imageWorkflowNodeId"] = gen_id
        note(f"S{idx}: 离线建流 {wid} (refs={[r['title'] for r in refs]})")
        touched_shards.add(wf_shard_rel)
        touched_shards.add(rel)

    print(f"===== 修复计划 ({len(plan)} 步, 触及 {len(touched_shards)} 分片, 删 {len(deleted_wfs)} 流) =====")
    for line in plan:
        print(" ", line)
    if not apply:
        print("dry-run 完成(未写盘)。--apply 执行。")
        return

    # ---- 写盘 ----
    bak = STORE.parent / f"studio-workflow.bak-auditfix-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copytree(STORE, bak)
    print(f"快照: {bak}")

    # 先删败者(独立遍历,避免边改边读)
    for rel, doc in shards.items():
        lst = doc.get("state", {}).get("imageWorkflows")
        if lst is None:
            continue
        keep = [w for w in lst if w.get("id") not in deleted_wfs]
        if len(keep) != len(lst):
            doc["state"]["imageWorkflows"] = keep

    for rel in sorted(touched_shards):
        (STORE / rel).write_text(json.dumps(shards[rel], ensure_ascii=False, indent=2) + "\n")
        print(f"写盘: {rel}")
    print("apply 完成。")


def resolve_legacy(mp: str) -> Path:
    if mp.startswith("project-file://"):
        rest = mp[len("project-file://"):].split("?")[0]
        pid, _, tail = rest.partition("/")
        root = Path("/Users/zhengbingjin/Project/IP/MA") if pid == PID else Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p") / pid
        return root / "/".join(unquote(x) for x in tail.split("/"))
    return Path(unquote(mp))


if __name__ == "__main__":
    main()
