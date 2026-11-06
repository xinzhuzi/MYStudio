#!/usr/bin/env python3
"""E1｜MiniMaxH3TokenCounter 十格上限表探针(payload-only,零实体文件)。

Trellis 11-06-xiaohei-h3ltx-absorb E1;口径来自 prd C4/C9/C13 与 1106 grill 轮 Q3 裁定:
  · 真源三段链 **不加** 计数件(C4)——本脚本把 UI 真源用既有转换器
    (`h3_template_to_api_1027.convert`,object_info 键序真源=引擎)转 API prompt 后,
    **在内存 payload 里**临时接一枚 `MiniMaxH3TokenCounter` 只跑到它(走 TE 不采样)。
  · 引擎用户区/工作流库/分镜域 **零写入**(C9:引擎用户区会话禁写恒零);证据只落
    `apps/output/xiaohei-absorb-e1-1106/`(运行态产物,不入 git)。
  · 十格(Q3 裁定:六格扩为九格再补 2MP×192f 对照,与 1105「贴顶 97.6%」那发同格)=
    0.4MP 864×480 / 0.9MP 1280×736 / 1.0MP 1376×768 × 33/96/192f + 2MP 1920×1056×192f。

计数件语义(源码实读 `comfyui-kjnodes/nodes/minimax_nodes.py:209-296`,Win/Mac 双机均已注册):
  入 `samples`=**AV latent**(H3 潜空间节点原样输出,嵌套则 unbind 取 audio_t)、
  入 `conditioning`=**正面 conditioning**;出 0/1 原样透传,出 2 tokens(INT),出 3 breakdown(STRING),
  且 `ui=ui.PreviewText(breakdown)` → **`/history` 的 `outputs.<id>.text` 逐字可见**(读数靠这个,不靠截图)。
  text 项取 `cond.shape[1]` ⇒ **必须真跑 TE**(故本探针需要显存窗口,不是纯静态算式);
  警告线=`minimax_nodes.py:275-276` `layout.seq_len * 7168 >= 2**31`,即
  `2**31 // 7168 = 299,593 tokens`(breakdown 里自带 ⚠)。

门禁(不过就不提交,绝不与他人 Job 抢卡):
  每格提交前重验 `/queue` running==0 且 pending==0(prd「跑前 /queue 必须 0/0」),
  `/system_stats` vram_free ≥ `--min-free-mib`(默认 18,432 MiB;TE 实测 15.69 GB nvfp4),
  且计数件在 `/object_info` 在册。任一不满足 → exit 3 并打印实测数,不跑半格。
  跑过一格后显存门改走**自家常驻基线**:本探针把 TE/VAE 吃进显存且被 ComfyUI 缓存常驻,
  free 会长期低于开机门(实测 24G 卡 18,432→7,609 MiB),这不是"他人抢卡"。故显存门取
  `min(--min-free-mib, 自家基线 − 1,024 MiB)`,自家基线=本轮开跑前实测 free 与各格跑完后的
  free 之最小值(上一轮探针残留的常驻同样计入基线);再掉一个 GiB 才判他人插队。

用法:
  python3 apps/build/scripts/xiaohei_absorb_e1_token_probe_1106.py                 # 跑十格,出表到 stdout+证据目录
  python3 apps/build/scripts/xiaohei_absorb_e1_token_probe_1106.py --dry-run       # 只装 payload+打印门禁实测,零提交
  python3 apps/build/scripts/xiaohei_absorb_e1_token_probe_1106.py --cells 0,9     # 只跑指定格(索引从 0)
  python3 ... --refs a.jpg,b.png                                                   # 换参考件(槽序 Picture 1..5,少给即摘槽)
  python3 ... --no-refs                                                            # 摘全部参考槽,量 text+video+audio 底
  python3 ... --prompt-chars 1200                                                  # 用生产模板句填 N 字符,量 text 项系数
  python3 ... --write-doc                                                          # 十格全成才把表追加进 参数速查.md(默认不写文档)
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[3]  # scripts/ → build/ → apps/ → 仓库根
WF = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/pika-单镜视频-三段链.json"
CONVERTER = REPO / "apps/build/scripts/h3_template_to_api_1027.py"
DOC = REPO / "docs/comfyui-kb/参数速查.md"
OUTDIR = REPO / "apps/output/xiaohei-absorb-e1-1106"

HOST = "http://192.168.0.101:17000"   # Win 产线引擎(H3 权重与 TE 全在 Win;Mac 引擎无 H3 权重)
COUNTER = "MiniMaxH3TokenCounter"
SRC_ID = "16"                          # ①段 MiniMaxH3ReferenceToVideo:出 positive(0)+AV LATENT(1)
COUNTER_ID = "900"                     # 只在内存 payload 里存在,不落任何 json
PREVIEW_ID = "901"                     # PreviewAny(OUTPUT_NODE)= 闭包唯一出口,history 靠它读数
# (标签, 宽, 高, 帧数)——分辨率=1105 基线口径的整数倍档,帧数=33/96/192 三档
CELLS = [
    ("0.4MP 864×480×33f", 864, 480, 33),
    ("0.4MP 864×480×96f", 864, 480, 96),
    ("0.4MP 864×480×192f", 864, 480, 192),
    ("0.9MP 1280×736×33f", 1280, 736, 33),
    ("0.9MP 1280×736×96f", 1280, 736, 96),
    ("0.9MP 1280×736×192f", 1280, 736, 192),
    ("1.0MP 1376×768×33f", 1376, 768, 33),
    ("1.0MP 1376×768×96f", 1376, 768, 96),
    ("1.0MP 1376×768×192f", 1376, 768, 192),
    ("2MP 1920×1056×192f(1105 显存贴顶那档)", 1920, 1056, 192),
]
INT32_SAFE = 2 ** 31 // 7168  # = 299,593:计数件自己的警告线(minimax_nodes.py:275-276)
SELF_TOL_MIB = 1024           # 显存门容差:比"自家基线"再掉 1 GiB 才判他人插队

# 参考图槽:真源里 [9]/[110..113] 的 widget 值是 App 组装期才落地的**占位名**(磁盘上不存在),
# 直接提交会被 validate_prompt 判 "Invalid image file"(1106 实弹踩到)。探针在 payload 里把它们
# 换成 Win 引擎 input 目录**真实存在**的生产代表件(零写引擎),并逐件验在位。
# 口径:[16].ref_image_size="match"=每张参考图**只降不升**、保比例缩到"本次生成的像素面积",
# 故 ref 的 token 项由「生成面积 × 张数」主导、与源件绝对分辨率无关(比例只影响 32 对齐取整)。
IMAGE_SLOTS = {
    "9": "my-shot-sb-chapter-001-001.jpg",     # Picture 1=分镜帧(产线恒占首槽,768×429)
    "110": "yl3_ref_01_flat.png",              # Picture 2..5=角色/场景卡(2048×2706 竖版 flat)
    "111": "yl3_ref_02_flat.png",
    "112": "yl3_ref_03_flat.png",
    "113": "yl3_ref_04_flat.png",
}
SLOT_TO_REFKEY = {"9": "ref_images.ref_image_0", "110": "ref_images.ref_image_1",
                  "111": "ref_images.ref_image_2", "112": "ref_images.ref_image_3",
                  "113": "ref_images.ref_image_4"}
# 文本校准件:真源 [14] PrimitiveStringMultiline 出厂为空(组装器运行时才注入六段式),
# 空文本量出的 text 项不是生产量级。校准=用生产模板句重复到指定字符数,量 tokens/字符 系数。
CALIB_SENTENCE = ("For the target video, at 0.00 seconds into the target video, "
                  "<Picture 1> (storyboard frame) is fully referenced. ")

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 铁律:代理必绕,否则假离线


def _get(path: str, timeout: int = 30):
    with _OPENER.open(f"{HOST}{path}", timeout=timeout) as r:
        return json.load(r)


def _post(path: str, payload: dict, timeout: int = 60):
    req = urllib.request.Request(f"{HOST}{path}", data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # validate_prompt 的 node_errors 全在响应体里——不吞掉它就只能看见 "400 Bad Request"
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code} {body[:1500]}") from None


def _load_converter():
    spec = importlib.util.spec_from_file_location("h3_api_conv", CONVERTER)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _vram_free_mib() -> int:
    dev = next((d for d in _get("/system_stats", timeout=15).get("devices", [])
                if d.get("type") == "cuda"), {})
    return int(dev.get("vram_free") or 0) // (1024 * 1024)


def gates(min_free_mib: int, refs: dict[str, str] = None, own_floor_mib: int = 0) -> list[str]:
    """硬门禁实测;返回违规项(空=可提交)。每格前重验,不缓存。"""
    bad = []
    try:
        q = _get("/queue", timeout=15)
    except Exception as e:  # 单次空返回不得写成"离线"——但要能分辨
        return [f"引擎不可达:{type(e).__name__} {e}"]
    running, pending = len(q.get("queue_running") or []), len(q.get("queue_pending") or [])
    if running or pending:
        bad.append(f"/queue 非 0/0(running={running},pending={pending})——他人 Job 在途,禁抢卡")
    st = _get("/system_stats", timeout=15)
    dev = next((d for d in st.get("devices", []) if d.get("type") == "cuda"), None)
    if not dev:
        bad.append("/system_stats 无 cuda 设备")
    else:
        free = int(dev.get("vram_free") or 0) // (1024 * 1024)
        need = min(min_free_mib, own_floor_mib - SELF_TOL_MIB) if own_floor_mib else min_free_mib
        if free < need:
            bad.append(f"vram_free={free} MiB < 门 {need} MiB(开机门 {min_free_mib},"
                       f"自家常驻基线 {own_floor_mib or '未测'}−{SELF_TOL_MIB})")
    if not _get(f"/object_info/{COUNTER}", timeout=15).get(COUNTER):
        bad.append(f"{COUNTER} 未在 {HOST} 注册")
    for nid, fname in sorted((refs or {}).items(), key=lambda kv: int(kv[0])):
        if not _image_in_engine(fname):
            bad.append(f"参考件不在引擎 input 目录:[{nid}] {fname}(换件或中止,勿拿占位名提交)")
    return bad


def _image_in_engine(fname: str) -> bool:
    req = urllib.request.Request(
        f"{HOST}/view?filename={urllib.parse.quote(fname)}&type=input", method="HEAD")
    try:
        with _OPENER.open(req, timeout=15) as r:
            return r.status == 200
    except Exception:
        return False


def build_prompt(api: dict, w: int, h: int, length: int,
                 refs: dict[str, str] = None, prompt_text: str = "") -> dict:
    """内存 payload(闭包剪枝):[16] 的 width/height/length 由链接改标量(部件 widget 值合法),
    接计数件读 positive(0)+AV latent(1),再把它 breakdown 出口(槽 3)喂唯一输出件
    `PreviewAny`——引擎 `execution.validate_prompt` 以 OUTPUT_NODE 为汇做闭包执行,真源里三枚
    SaveVideo([4]/[204]/[336])若留在 payload 里会把整条产线跑起来,故显式剪到闭包,并只把预览件
    报为 `partial_execution_targets`。真源与磁盘零改。"""
    p = copy.deepcopy(api)
    src = p.get(SRC_ID)
    if not src or src.get("class_type") != "MiniMaxH3ReferenceToVideo":
        raise SystemExit(f"FAIL payload 锚 [{SRC_ID}] 不是 MiniMaxH3ReferenceToVideo"
                         f"(实际 {src.get('class_type') if src else '缺失'}),先核对三段链①段形态")
    src["inputs"].update({"width": w, "height": h, "length": length})
    for nid, fname in (refs or {}).items():
        node = p.get(nid)
        if node and node.get("class_type") == "LoadImage":
            node["inputs"]["image"] = fname
    if refs is not None:
        for nid, refkey in SLOT_TO_REFKEY.items():
            if nid not in refs:
                src["inputs"].pop(refkey, None)   # 闭包 walk 只看现存链接,摘槽即整件出局
    if prompt_text:
        for nid in ("14", "20"):        # ①段文本源=PrimitiveStringMultiline(真源出厂空值)
            node = p.get(nid)
            if node and node.get("class_type", "").endswith("StringMultiline"):
                node["inputs"]["value"] = prompt_text

    p[COUNTER_ID] = {
        "class_type": COUNTER,
        "inputs": {"samples": [SRC_ID, 1], "conditioning": [SRC_ID, 0]},
        "_meta": {"title": f"E1 token 探针 {w}×{h}×{length}f"},
    }
    p[PREVIEW_ID] = {"class_type": "PreviewAny", "inputs": {"source": [COUNTER_ID, 3]},
                     "_meta": {"title": "E1 breakdown 读数(payload 专属输出件)"}}

    need: set[str] = set()

    def walk(nid: str):
        if nid in need:
            return
        if nid not in p:
            raise SystemExit(f"FAIL 闭包缺件 {nid}(payload 里不存在)")
        need.add(nid)
        for v in (p[nid].get("inputs") or {}).values():
            if isinstance(v, (list, tuple)) and len(v) >= 2 and str(v[0]) in p:
                walk(str(v[0]))

    walk(PREVIEW_ID)
    return {k: p[k] for k in sorted(need, key=int)}


def _text_of(node_out: dict) -> str:
    """history 读数:PreviewAny 落 `text: [裸串]`,v3 PreviewText 落 `text: [{"text": ...}]`——两种都吃。"""
    t = (node_out or {}).get("text")
    if isinstance(t, list) and t:
        v = t[0]
        if isinstance(v, dict):
            v = v.get("text")
        if isinstance(v, str):
            return v
    return ""


def run_cell(api: dict, label: str, w: int, h: int, length: int, timeout: int,
             refs: dict[str, str], prompt_text: str = "") -> dict:
    prompt = build_prompt(api, w, h, length, refs, prompt_text)
    res = _post("/prompt", {"prompt": prompt, "client_id": "e1-token-probe-1106",
                            "partial_execution_targets": [PREVIEW_ID]})
    pid = res["prompt_id"]
    deadline = time.time() + timeout
    rec = None
    while time.time() < deadline:
        rec = _get(f"/history/{pid}", timeout=20).get(pid)
        if rec:
            break
        time.sleep(2)
    if not rec:
        raise RuntimeError(f"{label}:prompt {pid} {timeout}s 未落 history")
    outs = rec.get("outputs") or {}
    breakdown = _text_of(outs.get(PREVIEW_ID)) or _text_of(outs.get(COUNTER_ID))
    if not breakdown:
        raise RuntimeError(f"{label}:history 无 breakdown(outputs keys={sorted(outs)})")
    fields = {}
    for line in breakdown.splitlines():
        k, _, v = line.partition(":")
        fields[k.strip()] = v.strip()
    status = (rec.get("status") or {})
    return {
        "label": label, "width": w, "height": h, "length": length,
        "refs": list(refs.values()), "prompt_chars": len(prompt_text),
        "prompt_id": pid, "payload_nodes": len(prompt), "history_nodes": sorted(outs, key=int),
        "tokens": int(fields.get("total", "-1")),
        "breakdown": fields,
        "int32_safe_limit": INT32_SAFE,
        "percent_of_safe": round(100.0 * int(fields.get("total", 0)) / INT32_SAFE, 2),
        "warning": fields.get("WARNING"),
        "status": status.get("status_str"),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def md_table(rows: list[dict]) -> str:
    head = ("| 档(分辨率×帧数) | tokens | 占 int32 安全线(299,593) | text | video patches | audio | 参考/关键帧 | 状态 |\n"
            "|---|---|---|---|---|---|---|---|\n")
    out = []
    for r in rows:
        b = r["breakdown"]
        refs = " / ".join(x for x in (b.get("keyframes"), b.get("image/video refs"), b.get("audio refs")) if x) or "—"
        out.append(f"| {r['label']} | {r['tokens']:,} | {r['percent_of_safe']}% | {b.get('text', '—')} | "
                   f"{b.get('video', '—')} | {b.get('audio', '—')} | {refs} | {r['status']} |")
    return head + "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只装 payload + 打印门禁实测,零提交")
    ap.add_argument("--cells", default="", help="逗号分隔的格索引,如 0,9")
    ap.add_argument("--min-free-mib", type=int, default=18432)
    ap.add_argument("--timeout", type=int, default=900, help="单格 history 等待上限(首格含 TE 加载)")
    ap.add_argument("--write-doc", action="store_true", help="十格全成才把表追加进 参数速查.md 末尾")
    ap.add_argument("--refs", default="", help="逗号分隔的引擎 input 件名,按 Picture 1..5 槽序覆盖"
                                              "默认生产代表件;给少于 5 个则多余参考槽从 payload 摘除")
    ap.add_argument("--no-refs", action="store_true", help="摘掉全部 5 个参考槽(量 text+video+audio 底)")
    ap.add_argument("--prompt-chars", type=int, default=0,
                    help="用生产模板句填 N 字符做 text 校准(默认 0=真源出厂空值)")
    a = ap.parse_args()

    slots = list(IMAGE_SLOTS)
    if a.no_refs:
        refs = {}
    elif a.refs:
        names = [x.strip() for x in a.refs.split(",") if x.strip()]
        refs = dict(zip(slots[:len(names)], names))
    else:
        refs = dict(IMAGE_SLOTS)
    prompt_text = (CALIB_SENTENCE * (a.prompt_chars // len(CALIB_SENTENCE) + 1))[:a.prompt_chars] \
        if a.prompt_chars > 0 else ""

    idxs = [int(x) for x in a.cells.split(",")] if a.cells else list(range(len(CELLS)))
    own_floor = _vram_free_mib()          # 自家基线:含上一轮探针常驻的显存,不拿来冒充"他人抢卡"
    bad = gates(a.min_free_mib, refs, own_floor)
    print(f"门禁:{'通过' if not bad else bad}(显存基线={own_floor} MiB)")
    print(f"参考件({len(refs)} 槽)={list(refs.values())} text 校准={a.prompt_chars} 字符")
    if bad and not a.dry_run:
        print("E1 停手:门禁不过不跑半格(等窗口,勿抢卡)。")
        return 3

    conv = _load_converter()
    canvas = json.loads(WF.read_text(encoding="utf-8"))
    oi = _get("/object_info", timeout=180)
    api, skipped = conv.convert(canvas, oi)
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / "api_prompt_used.json").write_text(json.dumps(api, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTDIR / "converter_skipped.txt").write_text("\n".join(skipped), encoding="utf-8")
    print(f"API prompt:{len(api)} 件(转换器跳过 {len(skipped)} 件不在 object_info 的 UI 专属件={skipped});"
          f"真源磁盘零改,锚 [{SRC_ID}] inputs={sorted(api[SRC_ID]['inputs'])}")
    if a.dry_run:
        for i in idxs:
            label, w, h, length = CELLS[i]
            p = build_prompt(api, w, h, length, refs, prompt_text)
            banned = [k for k in p if p[k]["class_type"] in
                      ("SamplerCustomAdvanced", "SaveVideo", "VAEDecode", "TesseraRefine")]
            print(f"  DRY 格{i} {label}:闭包 {len(p)} 件={sorted(p, key=int)}"
                  f" 计数/预览在位={COUNTER_ID in p and PREVIEW_ID in p} 采样件混入={banned}"
                  f" 参考槽实连={[k for k in p[SRC_ID]['inputs'] if k.startswith('ref_images')]}")
            if banned:
                return 1
        return 0

    rows, failures = [], []

    def dump(free: int):
        (OUTDIR / "token_cells.json").write_text(
            json.dumps({"host": HOST, "cells": rows, "failures": failures,
                        "vram_free_mib_after": free, "self_cache_floor_mib": own_floor,
                        "int32_safe_limit": INT32_SAFE},
                       ensure_ascii=False, indent=2), encoding="utf-8")

    for n, i in enumerate(idxs):
        label, w, h, length = CELLS[i]
        try:
            bad = gates(a.min_free_mib, refs, own_floor)   # 每格前重验:他人插 Job 立刻停,不交错
        except Exception as e:
            bad = [f"门禁读数异常:{type(e).__name__} {e}"]
        if bad:
            free = _vram_free_mib()
            failures.append(f"格{i} {label}:门禁中途失败 {bad}")
            print(f"[{n + 1}/{len(idxs)}] {label} ⛔ 门禁中途失败(等窗口,勿抢卡):{bad}")
            dump(free)
            break
        try:
            r = run_cell(api, label, w, h, length, a.timeout, refs, prompt_text)
            rows.append(r)
            print(f"[{n + 1}/{len(idxs)}] {label} → {r['tokens']:,} tokens"
                  f"({r['percent_of_safe']}% 安全线) text={r['breakdown'].get('text')}")
        except Exception as e:
            failures.append(f"格{i} {label}:{type(e).__name__} {e}")
            print(f"[{n + 1}/{len(idxs)}] {label} ❌ {failures[-1]}")
        free = _vram_free_mib()
        own_floor = min(own_floor, free)
        dump(free)

    print("\n" + md_table(rows))
    if failures:
        print(f"\n不完整:{len(rows)}/{len(idxs)} 成,失败/中断见上;文档不动。")
        return 1
    if a.write_doc:
        block = ("\n## 小黑 H3 TokenCounter 十格上限表(1106 E1,payload-only 探针实测)\n\n"
                 f"探针=真源三段链转 API prompt 后在内存里临时接 `MiniMaxH3TokenCounter`"
                 f"(①段 [{SRC_ID}] AV latent+positive,不采样只走 TE);真源零改件(C4/C9),"
                 f"证据 `apps/output/xiaohei-absorb-e1-1106/`。引擎={HOST}(Win 产线)。\n\n"
                 f"**进表输入(读数折扣必知)**:参考图 {len(refs)} 槽实件={list(refs.values())}"
                 f"(真源 widget 是 App 组装期占位名,磁盘无件,直接提交必被 validate 拒);text 校准"
                 f"={'生产模板句 ' + str(a.prompt_chars) + ' 字符' if prompt_text else '真源出厂空值(生产由组装器注入六段式,text 项按 tokens/字符 线性另加)'}"
                 f";`ref_image_size=match`=每张参考只降不升缩到本次生成像素面积,故 ref 项由面积×张数主导。\n\n"
                 + md_table(rows) + "\n")
        DOC.write_text(DOC.read_text(encoding="utf-8").rstrip("\n") + "\n" + block, encoding="utf-8")
        print(f"表已追加进 {DOC.relative_to(REPO)}(只追加,未重排他人 hunk)")
    else:
        print("十格全成;--write-doc 未给 → 文档不动(表已在 stdout)。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
