#!/usr/bin/env python3
"""角色设定表出图逻辑实弹(09-19;两步链:立绘 t2i → 设定板 charsheet i2i)。

三段腿(按序跑,均可 --only 单跑):
  charshot   立绘=K2-文生图-道劫.json [80]=人物/seed42/4步/1816×2424,
             主体句=九型示例「一位筑基后期的年轻女修」逐字(立绘=步2 参考图);
  pre-mod    改造前可复现面回归:现文件(未改造)同 payload 双跑,
             sha256 逐字节对比=零回归判据(VLM TextGenerate 确定性一并实证);
  post-mod   改造后 A/B:[304] MyDaojieBase 人物 vs 高清人脸(其余恒定),
             验 [90] preset=设定板 applied 清单逐字一致。

wf2api 三坑自查清单(09-18 在档,本脚本逐条落实):
  ① 旁路链重穿:lf._resolve_src mode=4 穿透(被旁路节点出槽回追入槽源);
  ② image_b 槽:未连线的可选 b 槽不进 API 图([119]/[85].image_b、
     [120].source_latent_b/source_image_b/ref_boost_mask/target_latent
     显式弹出;positional 只对 widget 型输入,连线型可选槽不占位);
  ③ sampling_mode.* 前缀:[162] TextGenerate 的 DynamicCombo 在 API 图是
     扁平前缀键(comfy_api/_io.py:1660 嵌套输入以父 id 前缀命名),
     本脚本显式构造 sampling_mode.on/temperature/… 扁平键,不交位置回退。

图双落 ~/Downloads/daojie_charsheet_0919/ 与仓库
docs/prompts/道劫_设定表实弹_0919/;runs_audit.json 台账(分段合并)。
用法:python3 apps/build/scripts/daojie_charsheet_logic_0919.py [--base-url …]
      [--only charshot|pre-mod|post-mod]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import shutil
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_livefire_0917 as lf  # noqa: E402
from daojie_livefire_0917 import http_bytes, http_json  # noqa: E402

lf.SKIP_NODES = {20, 61, 88}          # t2i 腿:种子/分辨率/分组旁路器 UI 件内联
lf.UI_ONLY_WIDGETS = lf.UI_ONLY_WIDGETS | {"upload"}  # LoadImage 上传件纯 UI

WF_T2I = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
          / "K2-文生图-道劫.json")
WF_SHEET = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
            / "K2-角色设定-道劫.json")
BASES_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
STACK_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
DOWNLOADS = Path.home() / "Downloads" / "daojie_charsheet_0919"
WS_DIR = REPO / "docs/prompts/道劫_设定表实弹_0919"
CLIENT_ID = "daojie-charsheet-logic-0919"
SEED_T2I = 42           # 立绘步(九型配方口径)
SEED_SHEET = 2027       # 设定板步(现流 [53] 默认种子,维持)
EXEC_TIMEOUT_S = 900
IDLE_WAIT_MAX_S = 600
POLL_S = 4

# 主体句=docs/prompts/道劫_九型主体句示例_0919.md §1 逐字(同脸锚=主体句全文恒定)
SUBJECT = ("一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，"
           "眉目沉静中带一点锋芒；她立于山门石阶最上一级，右手轻按剑柄未拔，"
           "视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。")

ASPECTS = {"1:1 (Square)": (1, 1), "3:4 (Portrait Standard)": (3, 4),
           "16:9 (Widescreen)": (16, 9), "21:9 (Ultrawide)": (21, 9)}
# 连线型类型:值由连线承载,不占 widget 位置序(坑②判据)
CONNECT_TYPES = frozenset({"IMAGE", "LATENT", "MASK", "VAE", "CLIP", "MODEL",
                           "CONDITIONING"})
# KSampler 旧式序列化:seed 后内嵌 control_after_generate 槽(object_info 序无此名)
CONTROL_VALUES = frozenset({"fixed", "increment", "decrement", "randomize"})


def native_px(aspect_label: str, megapixels: float, multiple: int = 8) -> tuple[int, int]:
    wr, hr = ASPECTS[aspect_label]
    total = megapixels * 1024 * 1024
    scale = math.sqrt(total / (wr * hr))
    return (round(wr * scale / multiple) * multiple,
            round(hr * scale / multiple) * multiple)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def widget_bearing(name: str, cls: str, oi: dict) -> bool:
    """该输入是否 widget 型(object_info spec 首元非连线类型且无 forceInput)。

    spec[0] 兼容裸 combo 形态(直接是选项 list)——统一 str() 后比较。"""
    spec = (oi[cls]["input"].get("required", {}).get(name)
            or oi[cls]["input"].get("optional", {}).get(name))
    if not spec:
        return False
    if len(spec) > 1 and isinstance(spec[1], dict) and spec[1].get("forceInput"):
        return False
    return str(spec[0]) not in CONNECT_TYPES


def _resolve_src_sheet(nodes, links, nid, slot, depth=0):
    """坑①+虚拟件:mode=4 旁路穿透(lf 同法)+ Reroute 恒穿透(前端虚拟节点,
    object_info 无注册,API 图不落节点)。"""
    node = nodes.get(nid)
    if node is None:
        raise RuntimeError(f"连线源节点 {nid} 不在工作流")
    if node.get("type") == "Reroute" or node.get("mode") == 4:
        if depth > 16:
            raise RuntimeError(f"穿透超过 16 层(节点 {nid}),疑似环路")
        in_slots = node.get("inputs") or []
        if slot >= len(in_slots):
            raise RuntimeError(f"穿透节点 {nid} 出槽 {slot} 无同序入槽")
        lid = in_slots[slot].get("link")
        if lid is None or lid not in links:
            raise RuntimeError(f"穿透节点 {nid} 入槽 {slot} 未连线")
        up = links[lid]
        return _resolve_src_sheet(nodes, links, up[1], up[2], depth + 1)
    return nid, slot


# 设定板 API 图不入的显示件(预览对比臂,不在 [29] 存盘路径;兼避 AddLabel
# 序列化歧义);MarkdownNote 由 SKIP_TYPES 兜底
SKIP_SHEET_NODES = {125, 126, 137, 138}


def ui_to_api_sheet(wf: dict, oi: dict, overrides: dict) -> dict:
    """charsheet 流 UI→API(三坑全处理版;t2i 腿走 lf.ui_to_api 原版)。

    与 lf.ui_to_api 的差异:
      · 坑②:widget 序按 object_info 重建后按「下标」对齐 wv(链接化 widget 的
        占位值仍留在 wv 里,旧法 len(positional)==len(wv) 必然错位——[119] 的
        prompt 文本会喂进 image_b);未连线连线型可选槽一律不进 API 图;
      · 坑①:mode=4 穿透 + Reroute 虚拟节点穿透(复用 lf 深度上限纪律);
      · 坑③:[162] TextGenerate 的 DynamicCombo 显式扁平前缀键,整节点独建,
        不交通用对齐;
      · LoadImage 上传件剥除(i2i 0919 惯例)。
    """
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf.get("links", [])}
    bypassed = {nid for nid, n in nodes.items() if n.get("mode") == 4}
    if bypassed:
        print(f"[charsheet] 旁路节点不入 API 图(mode=4,坑①穿透): {sorted(bypassed)}",
              flush=True)
    prompt: dict[str, dict] = {}
    for nid, n in nodes.items():
        if (n["type"] in lf.SKIP_TYPES or nid in bypassed or nid in SKIP_SHEET_NODES
                or n.get("type") == "Reroute"):
            continue
        cls = n["type"]
        order = (list(oi[cls]["input"].get("required", {}).keys())
                 + list(oi[cls]["input"].get("optional", {}).keys()))
        named = n.get("widgets_values_named") or {}
        wv = list(n.get("widgets_values") or [])
        if n["type"] == "LoadImage" and len(wv) > 1:  # upload 件剥除
            wv = wv[:1]
        linked = {}
        for slot_def in n.get("inputs") or []:
            lid = slot_def.get("link")
            if lid is None or lid not in links:
                continue
            src = links[lid][1]
            if src in lf.SKIP_NODES or src in SKIP_SHEET_NODES:
                continue
            src, out_slot = _resolve_src_sheet(nodes, links, src, links[lid][2])  # 坑①
            linked[slot_def["name"]] = [str(src), out_slot]
        if nid == 162:  # 坑③:DynamicCombo——选项键=裸 sampling_mode,子参=前缀键
            # (comfy_api/_io.py DynamicCombo._expand_schema_for_dynamic:
            #  live_inputs[sampling_mode]=选项 key;子输入按 "sampling_mode.x" 扁平)
            # wv 序 = prompt, max_length, on, temperature, top_k, top_p, min_p,
            #         repetition_penalty, seed, presence_penalty, thinking, template
            vals = (list(wv) + [None] * 12)[:12]
            (p_txt, max_len, s_on, temp, top_k, top_p, min_p, rep_pen,
             s_seed, pres_pen, _think, _tpl) = vals
            prompt["162"] = {"class_type": cls, "inputs": {
                "clip": linked["clip"], "image": linked.get("image"),
                "prompt": linked.get("prompt") or (p_txt or ""),
                "max_length": max_len,
                "sampling_mode": s_on,
                "sampling_mode.temperature": temp,
                "sampling_mode.top_k": top_k,
                "sampling_mode.top_p": top_p,
                "sampling_mode.min_p": min_p,
                "sampling_mode.repetition_penalty": rep_pen,
                "sampling_mode.seed": s_seed,
                "sampling_mode.presence_penalty": pres_pen,
                "thinking": _think if _think is not None else False,
                "use_default_template": _tpl if _tpl is not None else True}}
            print(f"[charsheet] 节点162 TextGenerate 采样组已构造"
                  f"(坑③:sampling_mode={s_on!r}+子参前缀键)", flush=True)
            continue
        inputs: dict[str, object] = {}
        widget_seq = [name for name in order
                      if name not in lf.UI_ONLY_WIDGETS and widget_bearing(name, cls, oi)]
        if (len(wv) == len(widget_seq) + 1 and len(wv) >= 2
                and wv[1] in CONTROL_VALUES):
            print(f"[charsheet] 节点{nid} {cls} 剔旧式 control_after_generate "
                  f"位置槽({wv[1]})", flush=True)
            wv = wv[:1] + wv[2:]
        unlinked = [nm for nm in widget_seq if nm not in linked and nm not in named]
        if len(widget_seq) == len(wv) and wv:
            by_name = dict(zip(widget_seq, wv))  # 下标对齐(链接化占位值就地处)
            for name in unlinked:
                inputs[name] = by_name[name]
        elif len(unlinked) == len(wv) and wv:
            for name, val in zip(unlinked, wv):  # 旧布局(无链接化占位值)
                inputs[name] = val
        elif wv:
            raise RuntimeError(
                f"节点{nid} {cls} widget 对不齐: 序{widget_seq} vs wv{wv!r}")
        for name in order:
            if name not in inputs and name in named and name not in linked:
                inputs[name] = named[name]
        inputs.update(linked)
        leftover = {k for k in named if k not in order and k not in lf.UI_ONLY_WIDGETS}
        if leftover:
            print(f"[charsheet] 警告: 节点{nid} {cls} named 键 {leftover} "
                  f"不在输入序(显示件残留,忽略)", flush=True)
        if not inputs:
            raise RuntimeError(f"节点{nid} {cls} 映射为空")
        prompt[str(nid)] = {"class_type": cls, "inputs": inputs}
    for key, val in overrides.items():
        nid_s, field = key.split(".", 1)
        prompt[nid_s]["inputs"][field] = val
    return prompt


def upload_image(base: str, path: Path) -> str:
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
               .encode())
    body.write(b"Content-Type: image/png\r\n\r\n")
    body.write(path.read_bytes())
    body.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"{base}/upload/image", data=body.getvalue(), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read().decode())
    assert resp.get("name"), f"上传失败:{resp}"
    return resp["name"]


def png_mean(b: bytes) -> float:
    from PIL import Image
    with Image.open(io.BytesIO(b)) as im:
        return sum(im.convert("L").getdata()) / (im.width * im.height)


def wait_idle(base: str) -> bool:
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        try:
            q = http_json(f"{base}/queue", timeout=10)
        except Exception:
            time.sleep(5)
            continue
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(5)
    return False


def wait_done(base: str, pid: str) -> tuple[dict | None, float]:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid], round(time.time() - t0, 1)
        time.sleep(POLL_S)
    return None, round(time.time() - t0, 1)


def first_image(entry: dict, prefer_nid: str = "29") -> dict | None:
    """优先取 [29] SaveImage(存盘原图);显示件已被剥除,兜底任意图片输出。"""
    outputs = entry.get("outputs") or {}
    for nid_txt in (prefer_nid, *outputs.keys()):
        out = outputs.get(nid_txt) or {}
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and "filename" in x:
                        return x
    return None


def node_output_text(entry: dict, nid: str) -> str | None:
    out = (entry.get("outputs") or {}).get(nid) or {}
    texts = out.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def submit(base: str, graph: dict, rec: dict) -> dict:
    """提交+等完+取图;rec 就地充实;返回带 _png 或 skip_reason。"""
    if not wait_idle(base):
        rec["skip_reason"] = f"引擎忙(>{IDLE_WAIT_MAX_S}s)"
        return rec
    try:
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID},
                         timeout=60)
        if resp.get("node_errors"):
            rec.update(skip_reason="node_errors",
                       detail=json.dumps(resp["node_errors"], ensure_ascii=False)[:1500])
            return rec
        pid = resp["prompt_id"]
        rec["prompt_id"] = pid
        entry, wall = wait_done(base, pid)
        rec["wall_s"] = wall
        status = (entry or {}).get("status", {})
        if entry is None:
            rec["skip_reason"] = f"超时(>{EXEC_TIMEOUT_S}s)"
            return rec
        if status.get("status_str") != "success":
            errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
            rec.update(skip_reason="execution_failed", detail=errs[:1])
            return rec
        for nid_txt in ("90", "304"):
            t = node_output_text(entry, nid_txt)
            if t:
                rec[f"applied_{nid_txt}"] = t
        image = first_image(entry)
        if image is None:
            rec["skip_reason"] = "history 无图片输出"
            return rec
        q = (f"filename={urllib.parse.quote(image['filename'])}"
             f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
        png = http_bytes(f"{base}/view?{q}")
        rec.update(ran=True, bytes=len(png), sha256=sha256_bytes(png),
                   engine_image=image["filename"], png_mean=round(png_mean(png), 2))
        rec["_png"] = png
        return rec
    except Exception as exc:
        rec.update(skip_reason=f"异常:{type(exc).__name__}", detail=str(exc)[:400])
        return rec


def settle(rec: dict, name: str, save_png: bool = True) -> dict:
    rec["name"] = name
    png = rec.pop("_png", None)
    if png is not None and save_png:
        fname = f"{name}.png"
        dl, ws = DOWNLOADS / fname, WS_DIR / fname
        dl.write_bytes(png)
        shutil.copyfile(dl, ws)
        rec.update(output=str(dl), ws_copy=str(ws))
    elif png is not None:
        rec["png_discarded"] = True
    return rec


def expected_applied(preset: str, slots: list) -> str:
    plan = [(Path(s["file"]).stem, s["presets"][preset]["weight"])
            for s in slots if s["presets"][preset]["on"]]
    total = len([s for s in slots if s.get("file")])
    return (f"{preset}({len(plan)}/{total}):"
            + " + ".join(f"{stem}×{w:g}" for stem, w in plan))


def merge_audit(runs: list, section: str, extra: dict) -> None:
    audit_path = WS_DIR / "runs_audit.json"
    audit = {"status": "done", "task": "角色设定表出图逻辑实弹(09-19)",
             "sections": {}}
    if audit_path.is_file():
        try:
            audit = json.loads(audit_path.read_text(encoding="utf-8"))
        except ValueError:
            pass
    audit.setdefault("sections", {})[section] = {"runs": runs, **extra}
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8")
    print(f"[charsheet] 台账段「{section}」已写 {audit_path}", flush=True)


def probe_base() -> str:
    for port in (17001, 17000):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats",
                                        timeout=3):
                return f"http://127.0.0.1:{port}"
        except Exception:
            continue
    raise RuntimeError("引擎 17001/17000 双口均无监听")


def leg_charshot(base: str, oi: dict) -> Path | None:
    """步1 立绘:t2i [80]=人物/seed42/4步/1816×2424(九型配方口径)。"""
    bases = {e["zh"]: e for e in json.loads(BASES_JSON.read_text(encoding="utf-8"))}
    w, h = native_px(bases["人物"]["aspect_ratio"], bases["人物"]["megapixels"])
    wf = json.loads(WF_T2I.read_text(encoding="utf-8"))
    overrides = {"12.seed": SEED_T2I, "53.width": w, "53.height": h,
                 "50.value": SUBJECT, "80.base": "人物"}
    graph = lf.ui_to_api(json.loads(json.dumps(wf)), oi, overrides)
    graph["80"]["inputs"].pop("negative", None)  # 0919 惯例:可选槽未连线弹出
    rec: dict = {"ran": False, "seed": SEED_T2I, "steps": 4, "wh": f"{w}×{h}",
                 "subject_head": SUBJECT[:12]}
    rec = submit(base, graph, rec)
    settle(rec, "step1_立绘_人物型_seed42")
    merge_audit([rec], "charshot", {"seed": SEED_T2I, "subject": SUBJECT})
    print(f"[charsheet] 立绘 {'OK' if rec.get('ran') else rec.get('skip_reason')}"
          f" wall={rec.get('wall_s')}s", flush=True)
    if rec.get("detail"):
        print(f"[charsheet] detail: {rec['detail']}", flush=True)
    return DOWNLOADS / "step1_立绘_人物型_seed42.png" if rec.get("ran") else None


def sheet_graph(oi: dict, image_name: str, base_type: str | None,
                preset_expect: str | None) -> tuple[dict, dict]:
    """步2 设定板图构造;返回(graph, 关键输入摘要)。base_type=None=不动文件现值。"""
    wf = json.loads(WF_SHEET.read_text(encoding="utf-8"))
    overrides = {"72.image": image_name, "53.seed": SEED_SHEET}
    if base_type is not None and "304" in {str(n["id"]) for n in wf["nodes"]}:
        overrides["304.base"] = base_type
    graph = ui_to_api_sheet(wf, oi, overrides)
    summary = {"seed": graph["53"]["inputs"]["seed"],
               "steps": graph["53"]["inputs"]["steps"],
               "cfg": graph["53"]["inputs"]["cfg"],
               "image": graph["72"]["inputs"]["image"],
               "preset_90": graph["90"]["inputs"]["preset"],
               "preset_expect": preset_expect}
    if "304" in graph:
        summary["base_304"] = graph["304"]["inputs"]["base"]
    return graph, summary


def leg_pre_mod(base: str, oi: dict, ref_png: Path) -> bool:
    """改造前可复现面回归:同 payload 双跑,sha256 相等=零回归判据。"""
    up = upload_image(base, ref_png)
    print(f"[charsheet] pre-mod 参考图上传: {up}", flush=True)
    wf_now = json.loads(WF_SHEET.read_text(encoding="utf-8"))
    has_stack = any(n["id"] == 90 for n in wf_now["nodes"])
    preset_now = next((n["widgets_values"][0] for n in wf_now["nodes"]
                       if n["id"] == 90 and n.get("widgets_values")), "(无栈)")
    runs = []
    for i in (1, 2):
        graph, summary = sheet_graph(oi, up, None, None)
        rec: dict = {"ran": False, "dup": i, **summary}
        rec = submit(base, graph, rec)
        settle(rec, f"pre_mod_dup{i}", save_png=(i == 1))
        runs.append(rec)
        print(f"[charsheet] pre-mod #{i} {'OK' if rec.get('ran') else rec.get('skip_reason')}"
              f" wall={rec.get('wall_s')}s sha={str(rec.get('sha256'))[:16]}", flush=True)
        if rec.get("detail"):
            print(f"[charsheet] detail: {rec['detail']}", flush=True)
    sha = [r.get("sha256") for r in runs if r.get("ran")]
    zero_reg = len(sha) == 2 and sha[0] == sha[1]
    merge_audit(runs, "pre-mod", {
        "purpose": "改造前可复现面回归(同 payload 双跑,sha256 相等=零回归)",
        "zero_regression": zero_reg, "preset_90_at_run": preset_now,
        "has_stack_node": has_stack, "ref_image": str(ref_png)})
    print(f"[charsheet] pre-mod 零回归判定: {zero_reg}", flush=True)
    return zero_reg


def leg_post_mod(base: str, oi: dict, ref_png: Path, slots: list) -> bool:
    """改造后 A/B:[304] 人物 vs 高清人脸;[90] applied 逐字校验。"""
    up = upload_image(base, ref_png)
    want = expected_applied("设定板", slots)
    print(f"[charsheet] post-mod 参考图上传: {up}; 预期 applied: {want}", flush=True)
    runs, ok_all = [], True
    for tag, btype in (("step2_设定板_A_人物", "人物"),
                       ("step2_设定板_B_高清人脸", "高清人脸")):
        graph, summary = sheet_graph(oi, up, btype, want)
        rec: dict = {"ran": False, "base_type": btype, **summary}
        rec = submit(base, graph, rec)
        applied = rec.get("applied_90")
        if applied:
            rec["applied_90_ok"] = (applied == want)
            ok_all = ok_all and rec["applied_90_ok"]
        settle(rec, tag)
        runs.append(rec)
        print(f"[charsheet] post-mod {tag} {'OK' if rec.get('ran') else rec.get('skip_reason')}"
              f" applied_ok={rec.get('applied_90_ok')} wall={rec.get('wall_s')}s", flush=True)
        if rec.get("detail"):
            print(f"[charsheet] detail: {rec['detail']}", flush=True)
    merge_audit(runs, "post-mod", {
        "purpose": "改造后 A/B:底座型选对拍(人物 vs 高清人脸;其余恒定)",
        "expected_applied_90": want, "applied_all_ok": ok_all,
        "ref_image": str(ref_png)})
    return ok_all and all(r.get("ran") for r in runs)


def main() -> int:
    ap = argparse.ArgumentParser(description="角色设定表两步链实弹")
    ap.add_argument("--base-url", default=probe_base())
    ap.add_argument("--only", choices=["charshot", "pre-mod", "post-mod"], default=None,
                    help="只跑指定腿(默认按序全跑)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    WS_DIR.mkdir(parents=True, exist_ok=True)
    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)

    legs = [args.only] if args.only else ["charshot", "pre-mod", "post-mod"]
    ref_png = DOWNLOADS / "step1_立绘_人物型_seed42.png"
    rc = 0
    for leg in legs:
        if leg == "charshot":
            out = leg_charshot(base, oi)
            rc |= 0 if out else 1
            ref_png = out or ref_png
        elif leg == "pre-mod":
            if not ref_png.is_file():
                print("✗ 缺立绘参考图(先跑 --only charshot)", file=sys.stderr)
                rc |= 1
                continue
            ok = leg_pre_mod(base, oi, ref_png)
            rc |= 0 if ok else 1
        elif leg == "post-mod":
            if not ref_png.is_file():
                print("✗ 缺立绘参考图(先跑 --only charshot)", file=sys.stderr)
                rc |= 1
                continue
            ok = leg_post_mod(base, oi, ref_png, slots)
            rc |= 0 if ok else 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
