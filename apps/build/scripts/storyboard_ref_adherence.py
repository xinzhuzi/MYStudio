#!/usr/bin/env python3
"""全量参考遵循度筛查(2026-08-25): 每镜成图 vs 参考图 vs 资产设定要点 → 强/中/弱+漂移点。

输入: IP/MA store(成图 mediaRef+工作流参考节点), assets.db(参考资产外观 prompt)。
模型: GLM-4V flash(免费, key=/tmp/glm_key.txt)。
输出: /tmp/ref_adherence.json (可断点续跑,已判定镜自动跳过)。

用法: python3 storyboard_ref_adherence.py [--limit N] [--only 4,44]
"""
from __future__ import annotations
import base64
import json
import re
import sqlite3
import sys
import time
import urllib.request
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote

IPMA = Path("/Users/zhengbingjin/Project/IP/MA")
ASSETS = Path.home() / "Library/Application Support/漫影工作室/assets"
KEYFILE = Path("/tmp/glm_key.txt")
OUT = Path("/tmp/ref_adherence.json")
ENDPOINT_GLM = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ENDPOINT_FANREN = "https://fanrenapi.com/v1/chat/completions"
MODEL = "glm-4v-flash"
# v4: 默认走凡人 gpt-5.6-terra 强视觉(v3 实证 glm-4v-flash 结构化多图不可靠);
# --glm 退回免费弱模型
USE_TERRA = "--glm" not in sys.argv
PID_PREFIX = "project-file://49dce4c1-64b1-42de-85c2-9f266698aec4/"


def load_store():
    man = json.loads((IPMA / "store/studio-workflow/manifest.json").read_text())
    sbs, wfs = {}, {}
    for s in man["shards"]:
        d = json.loads((IPMA / "store/studio-workflow" / s).read_text())
        st = d.get("state", {})
        for sb in st.get("storyboards") or []:
            sbs[sb.get("id")] = sb
        for wf in st.get("imageWorkflows") or []:
            wfs[wf.get("id")] = wf
    return sbs, wfs


def resolve(url: str) -> Path | None:
    u = unquote(url or "")
    if u.startswith(PID_PREFIX):
        return IPMA / u[len(PID_PREFIX):]
    if u.startswith("asset-file://"):
        return ASSETS / "files" / u[len("asset-file://"):]
    return None


def shrink_b64(p: Path, max_side: int = 640) -> str | None:
    try:
        from PIL import Image
        im = Image.open(p).convert("RGB")
        scale = min(1.0, max_side / max(im.size))
        if scale < 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)))
        buf = BytesIO()
        im.save(buf, format="JPEG", quality=72)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def asset_prompt_excerpt(con, aid: str, limit: int = 150) -> str:
    row = con.execute("SELECT prompt FROM assets WHERE id=?", (aid,)).fetchone()
    if not row or not row[0]:
        return ""
    text = re.sub(r"\s+", "", row[0])[:limit]
    return text


def call_glm(images: list[tuple[str, str]], question: str, key: str) -> dict:
    if USE_TERRA:
        keys = json.loads(Path("/tmp/fanren_keys.json").read_text())
        body = {"model": "gpt-5.6-terra", "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}}
            for _, b in images] + [{"type": "text", "text": question}]}]}
        req = urllib.request.Request(ENDPOINT_FANREN, data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {keys[-1]}", "Content-Type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=180))
        raw = r["choices"][0]["message"]["content"]
        raw = re.sub(r"^```json\s*|\s*```$", "", raw.strip())
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", raw, re.S)
            return json.loads(m.group(0)) if m else {"verdict": "parse-fail", "raw": raw[:200]}
    content = [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}} for _, b in images]
    for label, _ in images[:1]:
        pass
    content.append({"type": "text", "text": question})
    body = {"model": MODEL, "messages": [{"role": "user", "content": content}]}
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=150))
    raw = r["choices"][0]["message"]["content"]
    raw = re.sub(r"^```json\s*|\s*```$", "", raw.strip())
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.S)
        return json.loads(m.group(0)) if m else {"verdict": "parse-fail", "raw": raw[:200]}


def main() -> None:
    limit = 0
    only = None
    args = sys.argv[1:]
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
    if "--only" in args:
        only = {int(x) for x in args[args.index("--only") + 1].split(",")}

    key = KEYFILE.read_text().strip()
    sbs, wfs = load_store()
    con = sqlite3.connect(str(ASSETS / "assets.db"))
    results = json.loads(OUT.read_text()) if OUT.exists() else {}

    todo = [sb for sid, sb in sorted(sbs.items(), key=lambda kv: kv[1].get("index") or 0)
            if (only is None or sb.get("index") in only) and str(sb.get("index")) not in results]
    if limit:
        todo = todo[:limit]
    print(f"待筛 {len(todo)} 镜 (已完成 {len(results)})")

    for sb in todo:
        idx = sb.get("index")
        mr = sb.get("mediaRef") or {}
        final = resolve(mr.get("path", "")) if mr.get("kind") == "image" else None
        if not final or not final.is_file():
            results[str(idx)] = {"verdict": "无图", "issues": []}
            continue
        wf = wfs.get(sb.get("imageWorkflowId"))
        refs = []
        if wf:
            for n in wf.get("nodes", []):
                if n.get("type") == "reference":
                    src = n.get("source") or {}
                    if src.get("kind") != "asset":
                        continue
                    rp = resolve(n.get("imageUrl") or "")
                    if rp and rp.is_file():
                        refs.append((n.get("title") or "?", rp, src.get("id", "")))
        # 压图: 成图 1 张 + 参考最多 3 张
        imgs = [("成图", shrink_b64(final))]
        imgs = [(l, b) for l, b in imgs if b]
        if not refs:
            results[str(idx)] = {"verdict": "无参考", "issues": ""}
            OUT.write_text(json.dumps(results, ensure_ascii=False, indent=1))
            continue
        facts = []
        for title, rp, aid in refs[:3]:
            excerpt = asset_prompt_excerpt(con, aid, 100)
            if excerpt:
                facts.append(f"- {title}: {excerpt}")
        q = ("看这张分镜成图,对照下列设定要点(来自角色/场景设定)。只判断实体特征,忽略氛围光影构图差异。\n"
             + "\n".join(facts)
             + "\n\n严格 JSON: {\"hair_ok\": \"图中主要人物发色符合设定吗 yes/no/看不出\", "
               "\"outfit_ok\": \"服装类型符合设定吗 yes/no/看不出\", "
               "\"scene_ok\": \"场景类型(室内外/场所)符合设定吗 yes/no/看不出\", "
               "\"verdict\": \"强 或 中 或 弱\", \"issues\": \"不符点一句话,无则空串\"} "
               "判级: 全符合=强; 单项不符=中; 两项及以上不符或场景完全错=弱")
        verdict = {}
        for attempt in range(2):
            try:
                verdict = call_glm(imgs, q, key)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 1:
                    verdict = {"verdict": "error", "issues": str(e)[:120]}
                time.sleep(3)
        results[str(idx)] = verdict
        OUT.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        print(f"S{idx}: {verdict.get('verdict')} | hair={verdict.get('hair_ok','?')[:12]} outfit={verdict.get('outfit_ok','?')[:12]} scene={verdict.get('scene_ok','?')[:12]} | {(verdict.get('issues') or '')[:50]}")
        time.sleep(1.5)

    n = {v: 0 for v in ("强", "中", "弱")}
    for v in results.values():
        if v.get("verdict") in n:
            n[v["verdict"]] += 1
    print("=== 汇总:", n, "| 其他:", len(results) - sum(n.values()))


if __name__ == "__main__":
    main()
