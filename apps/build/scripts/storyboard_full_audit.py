#!/usr/bin/env python3
"""道劫分镜六维度全量审计(逐镜,非抽样)。

A 图片生成: mediaRef.kind==image 且路径真实存在、非空、PIL 可解码
B 名字匹配: associateAssetsNames 逐名对 assets.db(精确名→remark 模糊唯一命中),匹配不到的列出
C 节点匹配: 择优流(findStoryboardWorkflowForContext 语义: mediaRef 指向优先)的
   参考节点对清单覆盖、@图N 绑定一致、成图节点非空壳
D 资产反向覆盖: 有图且章节正文提及但从未被任何分镜引用的资产(该挂没挂候选)
E 路径架构: 所有引用串必须为 asset-file:// / project-file://(chapter 段)虚拟协议;
   绝对路径 / file:// / APP Support 旧夹 / 仓库种子路径 / 平铺 workflow-images 逐条列出
F 双源一致: sb.imageWorkflowId ↔ mediaRef.imageWorkflowId ↔ wf.target 双向、
   正文 prompt 长度门(>800,帧负面 686 固定段不计门)

用法: python3 storyboard_full_audit.py [--json OUT]
退出码=问题总数(0=干净);报告同时落 markdown。
"""
from __future__ import annotations
import io
import json
import re
import sqlite3
import sys
from pathlib import Path
from urllib.parse import unquote

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")
ASSETS = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets")
DB = ASSETS / "assets.db"
DATA_ROOT = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/projects")
REPO = "/Users/zhengbingjin/Project/Github/MYStudio"
FRAME_NEGATIVE_BUDGET = 686  # 手册分镜负面固定段,不计入正文长度门
PROMPT_GATE = 800
PREFIXES = ("监工", "管事", "老", "年轻", "小", "断臂")
# D 维度裁定豁免(2026-08-24 审计):被更细粒度资产覆盖,不补挂
D_ACCEPTED = {"道口镇": "被「道口镇街巷」细粒度场景资产覆盖"}


def project_location(pid: str) -> Path:
    reg = DATA_ROOT / "mystudio-project-store.json"
    try:
        data = json.loads(reg.read_text())
    except OSError:
        return DATA_ROOT / "_p" / pid

    def walk(o):
        if isinstance(o, dict):
            if o.get("id") == pid and o.get("location"):
                return o["location"]
            for v in o.values():
                r = walk(v)
                if r:
                    return r
        elif isinstance(o, list):
            for v in o:
                r = walk(v)
                if r:
                    return r
        return None

    return Path(walk(data) or DATA_ROOT / "_p" / pid)


def resolve_url(u: str) -> Path | None:
    if not u:
        return None
    if u.startswith("asset-file://"):
        rest = u[len("asset-file://"):].split("?")[0]
        return ASSETS / "files" / "/".join(unquote(x) for x in rest.split("/"))
    if u.startswith("project-file://"):
        rest = u[len("project-file://"):].split("?")[0]
        pid, _, tail = rest.partition("/")
        return project_location(pid) / "/".join(unquote(x) for x in tail.split("/"))
    if u.startswith("file://"):
        return Path(unquote(u[len("file://"):]))
    if u.startswith("/"):
        return Path(u)
    return None


def parse_asset_names(raw) -> list[str]:
    """镜像 parseAssetNames:四种分隔符 ; ； , ， 拆分。"""
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = re.split(r"[;；,，]", raw)
    else:
        parts = []
        for item in raw:
            parts += re.split(r"[;；,，]", str(item))
    return [p.strip() for p in parts if p.strip()]


def pil_readable(p: Path) -> tuple[bool, str]:
    try:
        from PIL import Image
        with Image.open(p) as im:
            im.verify()
        with Image.open(p) as im2:
            im2.load()
        return True, f"{p.stat().st_size}B"
    except Exception as e:  # noqa: BLE001
        return False, str(e)[:80]


def main() -> None:
    out_json = None
    if "--json" in sys.argv:
        out_json = sys.argv[sys.argv.index("--json") + 1]

    man = json.loads((STORE / "manifest.json").read_text())
    sbs, wfs = {}, {}
    for shard in man["shards"]:
        d = json.loads((STORE / shard).read_text())
        st = d.get("state", {})
        for sb in st.get("storyboards") or []:
            sbs[sb.get("id")] = sb
        for wf in st.get("imageWorkflows") or []:
            wfs[wf.get("id")] = wf

    con = sqlite3.connect(str(DB))
    assets = {}  # name -> (id, type, filePath)
    for aid, atype, name, fp in con.execute("SELECT id, type, name, filePath FROM assets"):
        assets.setdefault(name, (aid, atype, fp))
    all_names = list(assets)

    def resolve_asset(n):
        """精确名优先;唯一模糊命中才采用(batchMatch 语义)。"""
        if n in assets:
            return assets[n]
        hits = [m for m in all_names if n in m or m in n]
        return assets[hits[0]] if len(hits) == 1 else None

    def role_in_frame(name, sb):
        sem = sb.get("shotSemantics") or {}
        vis = [c.get("name") for c in (sem.get("visibleCharacters") or []) if isinstance(c, dict)]
        for v in vis:
            if name == v:
                return True
            for p in PREFIXES:
                if (name.startswith(p) and name[len(p):] == v) or (v.startswith(p) and v[len(p):] == name):
                    return True
        frame = (sb.get("videoDesc") or "") + (sb.get("prompt") or "") + (sb.get("lines") or "")
        if name in frame:
            return True
        return any(name.startswith(p) and len(name) > len(p) + 1 and name[len(p):] in frame for p in PREFIXES)

    def canonical_refs(sb):
        """产品口径(resolveStoryboardAssetReferences 镜像):场景≤1+画面内角色≤3,道具不挂。"""
        names = [n for n in (sb.get("associateAssetsNames") or []) if n]
        out = []
        for n in names:
            row = resolve_asset(n)
            if row and row[1] == "scene" and row[2] and (ASSETS / "files" / row[2]).is_file():
                out.append((n, row))
                break
        for n in names:
            row = resolve_asset(n)
            if row and row[1] == "role" and role_in_frame(n, sb) and row[2] and (ASSETS / "files" / row[2]).is_file():
                out.append((n, row))
                if sum(1 for r in out if r[1][1] == "role") >= 3:
                    break
        return [n for n, _ in out]

    problems: list[tuple[str, int | None, str]] = []

    by_target: dict[str, list] = {}
    for wf in wfs.values():
        t = wf.get("target") or {}
        if t.get("kind") == "storyboard":
            by_target.setdefault(t.get("id"), []).append(wf)

    # F 先行:工作流 target 反查
    for wid, wf in wfs.items():
        t = wf.get("target") or {}
        if t.get("kind") == "storyboard" and t.get("id") not in sbs:
            problems.append(("F", None, f"工作流[{wid}]target 指向不存在的分镜[{t.get('id')}]"))

    # 章节正文文本(D 维度剧情判断用)
    chapter_text = ""
    for sb in sbs.values():
        chapter_text += (sb.get("videoDesc") or "") + (sb.get("lines") or "") + (sb.get("prompt") or "")
    chapter_text = chapter_text.replace(" ", "").replace("\n", "")

    referenced_names: set[str] = set()
    referenced_ids: set[str] = set()

    for sid, sb in sorted(sbs.items(), key=lambda kv: kv[1].get("index") or 0):
        idx = sb.get("index")
        mr = sb.get("mediaRef") or {}
        names = parse_asset_names(sb.get("associateAssetsNames"))
        referenced_names.update(names)
        referenced_ids.update(sb.get("assetIds") or [])

        # ---- A 图片生成 ----
        if mr.get("kind") != "image":
            problems.append(("A", idx, f"mediaRef.kind={mr.get('kind') or '无'} (未生成)"))
        else:
            p = resolve_url(mr.get("path") or "")
            if p is None or not p.is_file():
                problems.append(("A", idx, f"成图路径不存在: {(mr.get('path') or '')[:90]}"))
            else:
                ok, info = pil_readable(p)
                if not ok:
                    problems.append(("A", idx, f"成图不可解码[{info}]: {p.name[:60]}"))

        # ---- B 名字匹配 ----
        for n in names:
            if resolve_asset(n) is not None:
                continue
            hits = [nm for nm in all_names if n in nm or nm in n]
            problems.append(("B", idx, f"清单名[{n}]在 assets.db 无精确/唯一模糊匹配(候选{len(hits)})"))

        # ---- C 节点匹配 ----
        pref_id = mr.get("imageWorkflowId") or sb.get("imageWorkflowId")
        flows = by_target.get(sid, [])
        pref = wfs.get(pref_id)
        if pref is None or (pref.get("target") or {}).get("id") != sid:
            if pref_id:
                problems.append(("C", idx, f"mediaRef 工作流[{str(pref_id)[:28]}]不存在或不指向本镜"))
            pref = None
        cand = pref or (flows[0] if flows else None)
        if cand is None:
            problems.append(("C", idx, "无任何图片工作流"))
        else:
            nodes = cand.get("nodes", [])
            refs = [n for n in nodes if n.get("type") == "reference"]
            gens = [n for n in nodes if n.get("type") == "generated"]
            ref_titles = {(r.get("title") or "").replace("·分层", "") for r in refs
                          if (r.get("source") or {}).get("kind") == "asset"}
            id_to_name = {v[0]: k for k, v in assets.items()}
            for r in refs:
                src = r.get("source") or {}
                if src.get("kind") == "asset" and src.get("id"):
                    referenced_ids.add(src["id"])
                    nm = id_to_name.get(src["id"])
                    if nm:
                        referenced_names.add(nm)
            # 参考覆盖:产品口径(场景≤1+画面内角色≤3,道具不挂)
            want = canonical_refs(sb)
            missing_refs = [n for n in want if n not in ref_titles
                            and not any(n in t or t in n for t in ref_titles)]
            if missing_refs:
                problems.append(("C", idx, f"择优流[{str(cand.get('id'))[-6:]}]缺口径参考: {missing_refs}"))
            # 跨代参考:资产参考 title 须对齐当前清单
            names_set = set(names)
            misaligned = [t for t in ref_titles if t and t not in names_set
                          and not any(t in n2 or n2 in t for n2 in names_set)]
            if misaligned:
                problems.append(("C", idx, f"择优流[{str(cand.get('id'))[-6:]}]参考跨代(清单外): {sorted(misaligned)}"))
            if not gens:
                problems.append(("C", idx, f"择优流[{str(cand.get('id'))[-6:]}]无成图节点(空壳)"))
            elif mr.get("kind") == "image":
                main_gen = next(
                    (g for g in gens if "背景板" not in (g.get("title") or "") and "净底" not in (g.get("title") or "")),
                    gens[0],
                )
                gu = main_gen.get("resultUrl") or main_gen.get("imageUrl") or main_gen.get("url") or ""
                if not gu:
                    problems.append(("C", idx, f"成图节点[{str(main_gen.get('id'))[-6:]}]无 resultUrl(空壳)"))
            # @图N 绑定一致(I3 同口径,对择优流)
            main_gen2 = next(
                (g for g in gens if "背景板" not in (g.get("title") or "") and "净底" not in (g.get("title") or "")),
                None,
            )
            if main_gen2:
                nd = {n["id"]: n for n in nodes}
                conn = [e for e in cand.get("edges", []) if e.get("target") == main_gen2["id"]]
                order = sorted(
                    (nd[e["source"]] for e in conn if nd.get(e.get("source"), {}).get("type") == "reference"),
                    key=lambda n: n.get("continuityOrder") or 99,
                )
                actual = {str(i + 1): (r.get("title") or "").replace("·分层", "") for i, r in enumerate(order)}
                prompt = next((n.get("prompt") or "" for n in nodes if n.get("type") == "prompt"), "")
                for num, claimed in re.findall(r"@图(\d+)\s*为\s*([^;；。,\s]+)", prompt):
                    act = actual.get(num)
                    if act and claimed not in act and act not in claimed:
                        problems.append(("C", idx, f"@图{num}绑定[{claimed}]≠实际[{act}]"))
            # 同镜多流(I6 口径)
            if len(flows) > 1:
                others = [f.get("id") for f in flows if f is not cand]
                problems.append(("C", idx, f"{len(flows)}流并存,择优外余流: {[str(o)[-12:] for o in others]}"))

        # ---- E 路径架构(本镜 mediaRef) ----
        mp = mr.get("path") or ""
        if mp:
            bad = classify_path(mp)
            if bad:
                problems.append(("E", idx, f"mediaRef 路径违规[{bad}]: {mp[:90]}"))
            # F: path 所属工作流文件夹须与 mediaRef.imageWorkflowId 一致
            m = re.search(r"workflow-images/[^/]+/([^/]+)/", unquote(mp))
            if m and pref_id and m.group(1) != pref_id:
                problems.append(("F", idx, f"mediaRef.path 属于流[{m.group(1)[:30]}]但 id 挂[{str(pref_id)[:30]}]"))
            # E/F: legacy 直出文件名(文件名形态非违规;违规=未绑定工作流)
            if re.search(r"sb-chapter-\d+-\d+-image\.\w+$", unquote(mp)) and not mr.get("imageWorkflowId"):
                problems.append(("F", idx, "mediaRef 指向 legacy 直出文件且未绑定工作流"))

        # ---- F 双源一致/长度门 ----
        # 未生成/待重生镜(mediaRef 无 kind=image)不比对两侧 id——sb 预绑为正确形态
        if mr.get("kind") == "image" and (sb.get("imageWorkflowId") or "") != (mr.get("imageWorkflowId") or ""):
            problems.append(("F", idx, f"sb.imageWorkflowId[{sb.get('imageWorkflowId')}]≠mediaRef[{mr.get('imageWorkflowId')}]"))
        # 正文一致: 择优流主 prompt 须含当前 videoDesc(12 字指纹)——旧代残缺正文出图即内容错位
        if cand is not None:
            vd = (sb.get("videoDesc") or "").strip()
            vkey = vd[:12] if len(vd) >= 12 else vd
            if vkey:
                mg2 = next((g for g in (cand.get("nodes", []) if isinstance(cand, dict) else [])
                            if g.get("type") == "generated"
                            and "背景板" not in (g.get("title") or "") and "净底" not in (g.get("title") or "")), None)
                mp2 = next((p for p in cand.get("nodes", []) if p.get("type") == "prompt"
                            and p.get("targetNodeId") == (mg2 or {}).get("id")),
                           next((p for p in cand.get("nodes", []) if p.get("type") == "prompt"), None))
                if mp2 and vkey not in (mp2.get("prompt") or ""):
                    problems.append(("F", idx, f"流正文与当前分镜脱节(无 videoDesc 指纹)"))
        plen = len(sb.get("prompt") or "")
        if plen > PROMPT_GATE:
            problems.append(("F", idx, f"分镜正文 prompt {plen} 字符超 {PROMPT_GATE} 门"))
        for wf2 in flows:
            for pn in wf2.get("nodes", []):
                if pn.get("type") == "prompt":
                    p2 = pn.get("prompt") or ""
                    neg = p2.count("负面") and len(p2)
                    if len(p2) - FRAME_NEGATIVE_BUDGET > PROMPT_GATE:
                        problems.append(("F", idx, f"流[{str(wf2.get('id'))[-6:]}]prompt {len(p2)}-{FRAME_NEGATIVE_BUDGET}>{PROMPT_GATE}"))

    # ---- E 路径架构(工作流所有节点 url) ----
    for wid, wf in wfs.items():
        for n in wf.get("nodes", []):
            for key in ("imageUrl", "url", "path", "imagePath"):
                u = n.get(key) or ""
                if not isinstance(u, str) or not u:
                    continue
                bad = classify_path(u)
                if bad:
                    problems.append(("E", None, f"wf[{str(wid)[-12:]}]node[{str(n.get('title'))[:14]}]{key} 违规[{bad}]: {u[:80]}"))

    # ---- D 反向覆盖(仅角色/场景/道具;audio 为音效素材不适用) ----
    unused = []
    for name, (aid, atype, _fp) in assets.items():
        if atype not in ("role", "scene", "tool"):
            continue
        if name in referenced_names or aid in referenced_ids:
            continue
        if name in D_ACCEPTED:
            continue
        row = con.execute("SELECT images, filePath FROM assets WHERE id=?", (aid,)).fetchone()
        imgs = []
        try:
            imgs = json.loads(row[0] or "[]") if row else []
        except json.JSONDecodeError:
            pass
        fp = row[1] if row else ""
        has_img = bool(imgs) and any((ASSETS / "files" / i.get("filePath", "")).is_file() for i in imgs if isinstance(i, dict))
        if not has_img and not (fp and (ASSETS / "files" / fp).is_file()):
            continue
        # 章节正文提及 → 该挂没挂候选;未提及 → 确实不用
        mentioned = name.replace(" ", "") in chapter_text
        if mentioned:
            unused.append((atype, name, aid, "章节正文提及但未被任何分镜引用"))

    for atype, name, aid, note in sorted(unused):
        problems.append(("D", None, f"[{atype}]{name} ({aid[:8]}): {note}"))

    # ---- 汇总 ----
    from collections import Counter
    cnt = Counter(p[0] for p in problems)
    lines = [f"全量审计: {len(sbs)} 镜 / {len(wfs)} 流 | 问题 {len(problems)} 条 | 分布 {dict(cnt)}"]
    for code, idx, msg in sorted(problems, key=lambda x: (x[0], x[1] if x[1] is not None else 999)):
        lines.append(f"  [{code}] S{idx if idx is not None else '--'}: {msg}")
    report = "\n".join(lines)
    print(report)
    if out_json:
        Path(out_json).write_text(json.dumps(problems, ensure_ascii=False, indent=1))
    sys.exit(len(problems))


def classify_path(u: str) -> str | None:
    """返回违规原因,None=合规。"""
    if u.startswith("asset-file://"):
        return None
    if u.startswith("project-file://"):
        rest = u[len("project-file://"):]
        m = re.match(r"^[^/]+/([^/?]+)", rest)
        seg = m.group(1) if m else ""
        if seg == "workflow-images":
            # 须有 chapter-xxx 段
            if not re.search(r"workflow-images/chapter-[^/]+/", unquote(rest)):
                return "平铺 workflow-images(无 chapter 段)"
        return None
    if u.startswith("file://"):
        return "file:// 绝对路径"
    if u.startswith("/"):
        if REPO in u:
            return "仓库种子路径"
        if "Application Support" in u:
            return "APP Support 旧夹绝对路径"
        return "绝对路径"
    if u.startswith(("http://", "https://", "data:", "local-image://")):
        return None
    if u.startswith("~"):
        return "~ 家目录路径"
    return "非虚拟协议裸串"


if __name__ == "__main__":
    main()
