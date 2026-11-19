#!/usr/bin/env python3
"""Gem② 4K帽(8.25MP)·十四型矩阵两段式 CLI · 1118。

首版超时教训:单发 world.run 10min 帽装不下排队+生成——改两段式:
  submit t2i <型> / submit i2i <型>   队列忙等 ≤120s(超时照样入队,引擎串行正典);
                                       提交即写状态文件 OUTDIR/<型>/state_<engine>.json
                                       (pid+型+seed+路),打印 [pid] 行后立刻退出 exit 0;
                                       引擎拒单 exit 8;矩阵缺料/自证失败/meta 缺席 exit 2。
  wait <型> <engine>                  读状态文件轮询 /history ≤510s;完成→下载双产物
                                       (node8 裸图+node504 超分)落 OUTDIR/<型>/<路>/ 并写
                                       meta.json+装配文后 exit 0;未完→exit 7(可无限次
                                       重入续等);执行错(引擎报 error/状态文件缺)→exit 8。
  audit <型> [t2i|i2i]                 从盘上 meta/产物/装配文重跑断言(逻辑与 wait 内联
                                       版全等:装配文含原文/压幅字面量/ceil 模型±1px+硬帽
                                       ≤3840/超帽双分支/t2i 实发记录),写回 meta;有 FAIL
                                       exit 1(断言失败记 FAIL 不拦截后续发车)。
  check                               矩阵+两图件零网络自证(不变)。

真源矩阵=gem_t8_matrix_1118.json(--matrix 覆写)。引擎硬编码 Win 生产面
http://192.168.0.101:17000(本机 home 缺 int8 convrot 栈,gem_t8_fire_1118.py
--base-url 实测定谳);启动即清 proxy 环境变量+ProxyHandler({}) 口径(照
gem_t8_type_sweep_1118.py),否则 Mac 壳连不上 Win。

覆写面(fail-closed,恰清单内):
  t2i 恰三点:[400].value=型主体句(400→6:4013 PE 关透传→正向提示词)、
             [6:4010].base=型、[7:7014] seed 随机;
  i2i 恰六点:[400].value=型指令(400→6:4014 原始指令)、[6:4010].base=型、
             [6:4011]+[6:4022] 组装用途=「道劫美术类型」、单参考剪链
             (pop 12/18/11/17 + 4015.images.image_2/3 + 悬引用零残留断言)、
             [10].image=上传 ref、[7:7014] seed 随机;
  i2i 压幅(复刻 apps/backend/engines/image_engine/qwen21.py:281-352
    _daojie_type_canvas/apply_ref_safe_canvas):qi21_bases 型画幅
    (resolution_override 直出/缺则 aspect_ratio×megapixels 公式)>1.25MP 者
    floor 32 对齐压回,字面量写 [4] EmptyLatentImage width/height(替换 WhSuggest
    连线);≤1.25MP 型保连线零动作。

④ 缺口修复(复核必改):产物按路分舱 <型>/t2i/ 与 <型>/i2i/(node8/node504 各落
对应子目录);装配文落 <型>/<路>_assembled_prompt.txt;i2i ref 解析=t2i meta 里
钉死的精确 bare 路径(禁 node8_*.png glob——重试/复跑后必歧义;meta 缺席时可回读
t2i 已完状态文件,两者皆缺即拒发报缺不猜);i2i 复跑重试不会误取 i2i 编辑图当 ref。

发前自证(每发,不变):8112 lora==r178 / 8118 steps==8 / 8117 句头 Upscale this
illustration / 8116 megapixels==8.25(1118末 4K帽新钉值);引擎 preflight
(/system_stats + LoraLoaderModelOnly combo 含 r178);队列软门=轮询 /queue 至
空闲,120s 未清照样入队(引擎串行正典),他役占队禁中断。

用法:
  python3 apps/build/scripts/gem_t8_matrix_fire_1118.py submit t2i 道具 [--dry-run]
  python3 apps/build/scripts/gem_t8_matrix_fire_1118.py submit i2i 人物海报 [--ref <png>]
  python3 apps/build/scripts/gem_t8_matrix_fire_1118.py wait 道具 192.168.0.101:17000
  python3 apps/build/scripts/gem_t8_matrix_fire_1118.py audit 道具 t2i
  python3 apps/build/scripts/gem_t8_matrix_fire_1118.py check
选项:--matrix PATH(缺省同目录 gem_t8_matrix_1118.json)/--poll-timeout S(510)/
     --idle-timeout S(120)/--dry-run(submit 注入面全构造+断言+状态文件写,不真发零网络)
"""
from __future__ import annotations

import argparse
import json
import math
import random
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENGINE = "http://192.168.0.101:17000"
TWIN_T2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
TWIN_I2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json"
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
OUTROOT = REPO / "apps/output/gem-t8-matrix-1118"
DEFAULT_MATRIX = Path(__file__).resolve().parent / "gem_t8_matrix_1118.json"
CLIENT = "gem-t8-matrix-1118"

NEW_LORA = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
RESTORE_LORA = "qwen-image-2.1-restore.safetensors"
PROMPT_HEAD = "Restore and upscale this illustration"  # 1119 v2 C句终稿头(594702e7 用户令:补回超分+超清词)
GEM_CAP_MP = 8.25            # 1118末 4K帽令(v2 WIDGETS[8100] 同源)
I2I_REF_SAFE_MP = 1.25       # qwen21.py:278 同值
HARD_CAP_EDGE = 3840         # 4K 帽:全型长边硬断言

# 退出码契约(1118 两段式令):0=成;2=拒发(矩阵缺料/自证失败/meta 缺席);
# 7=wait 未完可重入续等;8=引擎拒单/执行错/状态文件缺。
EXIT_OK, EXIT_REFUSE, EXIT_WAITING, EXIT_ERROR = 0, 2, 7, 8

# 启动即清 proxy(照 gem_t8_type_sweep_1118.py;Mac 壳连 Win 必须)
import os
for _k in list(os.environ):
    if "proxy" in _k.lower():
        del os.environ[_k]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Refuse(Exception):
    """拒发(矩阵缺料/自证失败/meta 缺席)——报缺不猜。"""


class EngineReject(Exception):
    """引擎拒单(400)或执行错——exit 8。"""


# ── 矩阵 ────────────────────────────────────────────────────────────────────
def need(cond: bool, msg: str) -> None:
    if not cond:
        raise Refuse(msg)


def load_matrix(path: Path) -> dict:
    m = json.loads(path.read_text(encoding="utf-8"))
    types = m.get("types", [])
    names = [t.get("type") for t in types]
    need(len(types) == 14, f"矩阵应 14 型,得 {len(types)}")
    need(len(set(names)) == 14, "矩阵型名重复")
    need(m.get("gem_cap_megapixels") == GEM_CAP_MP,
         f"矩阵 gem_cap_megapixels 应 {GEM_CAP_MP}(得 {m.get('gem_cap_megapixels')})")
    return {t["type"]: t for t in types}


# ── 压幅(复刻 qwen21.py:281-352,口径注释见彼处)────────────────────────────
def canvas_of(entry: dict) -> tuple[int, int] | None:
    ov = entry.get("resolution_override")
    if (isinstance(ov, (list, tuple)) and len(ov) == 2
            and all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in ov)):
        return int(ov[0]), int(ov[1])
    try:
        aw_s, ah_s = str(entry.get("aspect_ratio") or "").strip().split()[0].split(":")
        aw, ah = float(aw_s), float(ah_s)
        mp = float(entry.get("megapixels"))
    except (IndexError, TypeError, ValueError):
        return None
    if aw <= 0 or ah <= 0 or mp <= 0:
        return None
    edge = math.sqrt(1024 * 1024 * mp)
    return int(round(edge * aw / ah / 8)) * 8, int(round(edge * ah / aw / 8)) * 8


def i2i_compress_dims(base_type: str) -> tuple[int, int] | None:
    """>1.25MP 型返回压回字面量;≤安全档/表缺返回 None(零动作)。"""
    data = json.loads(BASES.read_text(encoding="utf-8"))
    entry = next((e for e in data.get("types", [])
                  if isinstance(e, dict) and e.get("zh") == base_type), None)
    if entry is None:
        return None
    dims = canvas_of(entry)
    if dims is None:
        return None
    cap_px = I2I_REF_SAFE_MP * 1_000_000
    w, h = dims
    if w <= 0 or h <= 0 or w * h <= cap_px:
        return None
    scale = math.sqrt(cap_px / (w * h))
    return (max(int(w * scale) // 32 * 32, 64), max(int(h * scale) // 32 * 32, 64))


# ── 504 期望(逐边 ceil 模型;1118 sweep 三组实发 3/3 全中反推)──────────────
def expect_504(w: int, h: int, mp: float = GEM_CAP_MP) -> tuple[int, int]:
    return math.ceil(math.sqrt(mp * 1e6 * w / h)), math.ceil(math.sqrt(mp * 1e6 * h / w))


# ── 注入面 ─────────────────────────────────────────────────────────────────
def self_check(graph: dict, tag: str) -> None:
    """1119 v2 锚:⑤b=皮肤件同构 11 节点(8100 系);旧 8112/8116/8117/8118 键应绝迹。"""
    for gone in ("8116", "8117", "8118"):  # 8112=v2 KSamplerSelect 在役键,勿误判
        need(gone not in graph, f"{tag}: 旧⑤b键 [{gone}] 应已绝迹(v2 换 8100 系)")
    g8101 = graph["8101"]["inputs"]
    g8102 = graph["8102"]["inputs"]
    g8104 = graph["8104"]["inputs"]
    g8100 = graph["8100"]["inputs"]
    need(g8101.get("lora_name") == NEW_LORA, f"{tag}: 8101 非 turbo r178(得 {g8101.get('lora_name')!r})")
    need(g8102.get("lora_name") == RESTORE_LORA and g8102.get("strength_model") == 1.0,
         f"{tag}: 8102 应 restore@1.0(得 {g8102.get('lora_name')!r}@{g8102.get('strength_model')})")
    need(str(g8104.get("prompt", "")).startswith(PROMPT_HEAD),
         f"{tag}: 8104 非 C 句句头")
    need(g8100.get("megapixels") == GEM_CAP_MP and type(g8100.get("megapixels")) is float,
         f"{tag}: 8100 megapixels 应 {GEM_CAP_MP}(得 {g8100.get('megapixels')!r})")


def build_t2i(entry: dict) -> tuple[dict, dict]:
    graph = json.loads(TWIN_T2I.read_text(encoding="utf-8"))["graph"]
    seed = random.randint(1, 2 ** 31 - 1)
    graph["400"]["inputs"]["value"] = entry["t2iSubject"]
    graph["6:4010"]["inputs"]["base"] = entry["type"]
    graph["7:7014"]["inputs"]["value"] = seed
    self_check(graph, f"t2i/{entry['type']}")
    return graph, {"seed": seed}


def build_i2i(entry: dict, ref_name: str | None) -> tuple[dict, dict]:
    instr = entry.get("i2iInstruction")
    need(isinstance(instr, str) and instr.strip(),
         f"i2i/{entry['type']}: 指令缺席(status={entry.get('i2iInstructionStatus')});"
         "PENDING-OWNER-WORDING 四型(场景/表情差分/人脸基准/无衣物定妆)待任务真源数组逐字,禁猜措辞拒发")
    need(entry.get("i2iApplicable") is True, f"i2i/{entry['type']}: i2iApplicable=false 拒发")
    graph = json.loads(TWIN_I2I.read_text(encoding="utf-8"))["graph"]
    seed = random.randint(1, 2 ** 31 - 1)
    graph["400"]["inputs"]["value"] = instr
    graph["6:4010"]["inputs"]["base"] = entry["type"]
    graph["6:4011"]["inputs"]["组装用途"] = "道劫美术类型"
    graph["6:4022"]["inputs"]["组装用途"] = "道劫美术类型"
    for k in ("12", "18", "11", "17"):
        graph.pop(k, None)
    graph["4015"]["inputs"].pop("images.image_2", None)
    graph["4015"]["inputs"].pop("images.image_3", None)
    dangling = [k for k, n in graph.items() for v in n["inputs"].values()
                if isinstance(v, list) and len(v) == 2 and v[0] in ("11", "12", "17", "18")]
    need(not dangling, f"i2i/{entry['type']}: 剪链残留引用 {dangling}")
    graph["7:7014"]["inputs"]["value"] = seed
    dims = i2i_compress_dims(entry["type"])
    if dims is not None:
        graph["4"]["inputs"]["width"] = dims[0]
        graph["4"]["inputs"]["height"] = dims[1]
    if ref_name is not None:
        graph["10"]["inputs"]["image"] = ref_name
    self_check(graph, f"i2i/{entry['type']}")
    return graph, {"seed": seed, "inject_canvas": (list(dims) if dims else None)}


# ── 引擎面(dry-run 零网络)────────────────────────────────────────────────
def get(p: str, t: float = 20) -> dict:
    with OPENER.open(ENGINE + p, timeout=t) as r:
        return json.load(r)


def preflight() -> None:
    info = get("/system_stats")
    print(f"[fire] 引擎在跑: comfyui {info['system'].get('comfyui_version', '?')}"
          f" (ram_free={info['system'].get('ram_free', 0) // (1024 ** 2)}MB)")
    combo = get("/object_info/LoraLoaderModelOnly")["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    need(NEW_LORA in combo, f"引擎 lora combo 缺 {NEW_LORA}(运行时 404 风险,拒发)")
    print(f"[fire] 引擎 combo 含 {NEW_LORA} ✓")


def wait_idle(timeout: float) -> None:
    """队列软门:至空闲才发;timeout 未清照样入队(引擎串行正典,禁中断他役)。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        q = get("/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            print("[fire] 队列空闲 ✓")
            return
        time.sleep(5)
    print(f"[fire] 队列 {timeout:.0f}s 未清空,照样入队(引擎串行正典)")


def post_prompt(graph: dict) -> str:
    req = urllib.request.Request(
        ENGINE + "/prompt",
        data=json.dumps({"prompt": graph, "client_id": CLIENT}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        return json.load(OPENER.open(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        raise EngineReject(f"引擎拒单 400: {e.read().decode()[:1200]}")


def fetch_history(pid: str) -> dict | None:
    """完成(有 images 产物)→ {'outputs','assembled'};未完→None;报错→EngineReject。"""
    try:
        hist = get(f"/history/{pid}", 15)
    except Exception:
        return None
    rec = hist.get(pid)
    if not rec:
        return None
    st = rec.get("status", {})
    if st.get("status_str") == "error":
        raise EngineReject(f"执行失败: {str(st.get('messages'))[:1200]}")
    outs = rec.get("outputs", {})
    if any("images" in o for o in outs.values()):
        texts = []
        for o in outs.values():
            ui = o.get("ui") or {}
            if "text" in ui:
                v = ui["text"]
                texts.append(v if isinstance(v, str) else "\n".join(map(str, v)))
        return {"outputs": outs, "assembled": (max(texts, key=len) if texts else None)}
    return None


def download(outs: dict, d: Path) -> list[dict]:
    got = []
    d.mkdir(parents=True, exist_ok=True)
    for nid in sorted(outs, key=lambda x: (len(x), x)):
        for img in outs[nid].get("images", []):
            url = (f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}"
                   f"&type={img.get('type', 'output')}&subfolder={urllib.parse.quote(img.get('subfolder', ''))}")
            data = OPENER.open(url, timeout=120).read()
            p = d / f"node{nid}_{img['filename']}"
            p.write_bytes(data)
            w, h = struct.unpack(">II", data[16:24])
            got.append({"node": nid, "path": str(p.relative_to(REPO)), "w": w, "h": h,
                        "bytes": len(data), "png_magic": data[:8] == b"\x89PNG\r\n\x1a\n"})
            print(f"  [dl] node {nid}: {p.name} {w}x{h} ({len(data)}B)")
    return got


def png_dims(p: Path) -> tuple[int, int]:
    data = p.read_bytes()[:24]
    return struct.unpack(">II", data[16:24])


def upload_image(path: Path, name: str) -> str:
    boundary = uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n",
        path.read_bytes(),
        f"\r\n--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n',
        f"--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        ENGINE + "/upload/image", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    got = json.load(OPENER.open(req, timeout=60)).get("name", name)
    print(f"  [up] {name} -> engine input: {got}")
    return got


# ── 状态文件(两段式枢杻)──────────────────────────────────────────────────
def engine_slug(engine: str) -> str:
    """http://192.168.0.101:17000 → 192.168.0.101_17000(容忍裸 host:port/slug 传入)。"""
    s = engine.split("://", 1)[-1]
    return s.replace(":", "_").replace("/", "_")


def state_path(typ: str, engine: str, dry: bool = False) -> Path:
    return OUTROOT / typ / f"{'state_dry_' if dry else 'state_'}{engine_slug(engine)}.json"


def write_state(typ: str, engine: str, payload: dict, dry: bool = False) -> Path:
    p = state_path(typ, engine, dry)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[fire] 状态文件: {p.relative_to(REPO)}")
    return p


def read_state(typ: str, engine: str) -> dict:
    p = state_path(typ, engine)
    if not p.is_file():
        raise EngineReject(f"状态文件缺席: {p.relative_to(REPO)}(先 submit {typ})")
    return json.loads(p.read_text(encoding="utf-8"))


def resolve_ref(entry: dict, override: Path | None) -> Path:
    """④缺口修复:ref=t2i 钉死的精确 bare 路径(禁 glob);--ref 显式覆写;
    正序=t2i meta.json bare.path → t2i 已完状态文件 bare;两者皆缺即拒发。"""
    if override is not None:
        p = override if override.is_absolute() else REPO / override
        need(p.is_file(), f"--ref 非文件: {p}")
        return p
    typ = entry["type"]
    meta_p = OUTROOT / typ / "t2i" / "meta.json"
    if meta_p.is_file():
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        bare = (meta.get("bare") or {}).get("path")
        need(isinstance(bare, str) and bare, f"{typ}: t2i meta 无 bare 钉死路径,i2i 拒发")
        p = REPO / bare
        need(p.is_file(), f"{typ}: t2i meta 钉死路径已失({bare}),i2i 拒发")
        print(f"[fire] ref=t2i meta 钉死路径 {bare}")
        return p
    st_p = state_path(typ, ENGINE)
    if st_p.is_file():
        st = json.loads(st_p.read_text(encoding="utf-8"))
        if st.get("route") == "t2i" and st.get("status") == "done":
            bare = (st.get("bare") or {}).get("path")
            if isinstance(bare, str) and (REPO / bare).is_file():
                print(f"[fire] ref=t2i 状态文件钉死路径 {bare}")
                return REPO / bare
    need(False, f"{typ}: t2i meta 缺席({meta_p.relative_to(REPO)})且无已完 t2i 状态,"
         "i2i 拒发——先 submit/wait t2i <型>(ref 恒取 t2i 裸图,不 glob 不猜)")


# ── audit(断言失败记 FAIL 不拦截;submit/wait/audit 三处共用)───────────────
def audit(entry: dict, route: str, assembled: str | None, products: list[dict],
          inject_canvas, over_cap: bool) -> dict:
    a: dict = {}
    by_node = {p["node"]: p for p in products}
    n8, n504 = by_node.get("8"), by_node.get("504")
    # ①装配文含原文
    if assembled is None:
        a["assembled_prompt"] = "NOT-RUN(history 无 ui.text,如实降级)"
    else:
        needle = entry["t2iSubject"] if route == "t2i" else entry["i2iInstruction"]
        a["assembled_prompt"] = "PASS" if needle in assembled else "FAIL(原文不在装配文)"
        if "\n" in needle and route == "t2i":
            # 设定卡双行句:装配文可能规范化换行,双行各自全在场亦放行并记录
            lines = needle.split("\n")
            a["assembled_prompt_multiline"] = ("PASS(逐行)" if all(l in assembled for l in lines)
                                               else "FAIL(逐行亦缺)")
    # ②i2i 压幅型:node8 实测==注入字面量
    if route == "i2i" and inject_canvas is not None and n8:
        a["inject_canvas_match"] = "PASS" if [n8["w"], n8["h"]] == list(inject_canvas) else \
            f"FAIL(node8 {n8['w']}x{n8['h']} ≠ 注入 {inject_canvas})"
    # ③504 期望=ceil 模型±1px/边 + 硬帽
    if n8 and n504:
        ew, eh = expect_504(n8["w"], n8["h"])
        cap_ok = max(n504["w"], n504["h"]) <= HARD_CAP_EDGE
        tol_ok = abs(n504["w"] - ew) <= 1 and abs(n504["h"] - eh) <= 1
        if over_cap:
            identical = [n504["w"], n504["h"]] == [n8["w"], n8["h"]]
            a["node504"] = (f"PASS(超帽源双分支:恒等直出)" if identical and cap_ok else
                            ("PASS(超帽源双分支:降采样≈ceil 模型)" if tol_ok and cap_ok else
                             f"FAIL(node504 {n504['w']}x{n504['h']} vs 期望 {ew}x{eh},帽内={cap_ok})"))
        else:
            a["node504"] = (f"PASS({n504['w']}x{n504['h']} vs ceil 模型 {ew}x{eh})" if tol_ok and cap_ok
                            else f"FAIL(node504 {n504['w']}x{n504['h']} vs 期望 {ew}x{eh},长边帽≤{HARD_CAP_EDGE}={'OK' if cap_ok else '破帽'})")
    # ④t2i 型画幅以实发为准(只记录)
    if route == "t2i" and n8:
        a["t2i_canvas_actual"] = f"{n8['w']}x{n8['h']}(以实发为准,WhSuggest 收整在案)"
    return a


def audit_has_fail(a: dict) -> bool:
    return any(isinstance(v, str) and v.startswith("FAIL") for v in a.values())


def finalize(entry: dict, route: str, res: dict, state: dict, products: list[dict],
             extra_meta: dict) -> dict:
    """wait 完成/audit 重跑共用:写装配文+meta,断言结果进 meta['audit']。"""
    typ = entry["type"]
    d = OUTROOT / typ / route
    assembled = None
    if res.get("assembled") is not None:
        assembled = res["assembled"]
        (OUTROOT / typ / f"{route}_assembled_prompt.txt").write_text(assembled, encoding="utf-8")
    by_node = {p["node"]: p for p in products}
    n8, n504 = by_node.get("8"), by_node.get("504")
    over = bool(n8 and n8["w"] * n8["h"] > GEM_CAP_MP * 1e6)
    a = audit(entry, route, assembled, products, state.get("inject_canvas"), over)
    meta = {"campaign": CLIENT, "engine": ENGINE, "route": route, "type": typ,
            "seed": state.get("seed"), "prompt_id": state.get("prompt_id"),
            "bare": n8, "upscale": n504, "products": products,
            "assembled_prompt": (f"{route}_assembled_prompt.txt" if assembled is not None else None),
            "audit": a, **extra_meta}
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return a


# ── CLI ────────────────────────────────────────────────────────────────────
def dry_report(route: str, entry: dict, graph: dict, info: dict) -> None:
    print(f"[dry] route={route} 型={entry['type']}")
    print(f"[dry] 覆写面: 400.value len={len(graph['400']['inputs']['value'])} 首16={graph['400']['inputs']['value'][:16]!r}")
    print(f"[dry] 6:4010.base={graph['6:4010']['inputs']['base']!r} seed={info['seed']}")
    if route == "i2i":
        print(f"[dry] 6:4011/6:4022 组装用途={graph['6:4011']['inputs'].get('组装用途')!r}/{graph['6:4022']['inputs'].get('组装用途')!r}")
        print(f"[dry] 剪链: 11/12/17/18 缺席={all(k not in graph for k in ('11', '12', '17', '18'))}"
              f" 4015.image_2/3 缺席={all(k not in graph['4015']['inputs'] for k in ('images.image_2', 'images.image_3'))}")
        print(f"[dry] 10.image={graph['10']['inputs'].get('image')!r} node4 width/height={graph['4']['inputs'].get('width')!r}/{graph['4']['inputs'].get('height')!r}"
              f" (压幅注入={info.get('inject_canvas')})")
    self_check(graph, f"dry/{route}/{entry['type']}")
    print("[dry] 发前自证四点 PASS(8101 r178/8102 restore@1.0/8104 C句头/8100=8.25)")
    if route == "t2i":
        # t2i 源画幅=node4 连线(WhSuggest),期望以实发为准;ceil 模型预览按 qi21_bases 公式画幅
        data = json.loads(BASES.read_text(encoding="utf-8"))
        be = next(e for e in data["types"] if e["zh"] == entry["type"])
        cw, ch = canvas_of(be) or (0, 0)
        print(f"[dry] qi21_bases 公式画幅={cw}x{ch} → 504 ceil 模型预览={expect_504(cw, ch)}"
              + ("(超帽源,双分支放行:恒等或降采样≈此值)" if cw * ch > GEM_CAP_MP * 1e6 else ""))
    else:
        dims = i2i_compress_dims(entry["type"])
        print(f"[dry] i2i 注入画幅={dims}(None=安全档内零动作) → 504 ceil 模型预览={expect_504(*dims)}" if dims
              else "[dry] i2i 安全档内型:WhSuggest 连线零动作,504 期望按 node8 实发现算")


def cmd_submit(args, matrix: dict) -> int:
    entry = matrix.get(args.type)
    need(entry is not None, f"矩阵无此型: {args.type}(在册 {[t for t in matrix]})")
    OUTROOT.mkdir(parents=True, exist_ok=True)

    if args.route == "t2i":
        graph, info = build_t2i(entry)
        if args.dry_run:
            dry_report("t2i", entry, graph, info)
            write_state(args.type, ENGINE, {"campaign": CLIENT, "engine": ENGINE, "route": "t2i",
                                            "type": entry["type"], "seed": info["seed"], "prompt_id": None,
                                            "status": "dry", "dry": True}, dry=True)
            print("[dry] 未发车(--dry-run 零网络;状态文件写路径已验=state_dry_ 前缀不污染真态)")
            return EXIT_OK
        preflight()
        wait_idle(args.idle_timeout)
        pid = post_prompt(graph)
        write_state(args.type, ENGINE, {"campaign": CLIENT, "engine": ENGINE, "route": "t2i",
                                        "type": entry["type"], "seed": info["seed"], "prompt_id": pid,
                                        "status": "submitted", "submitted_at": time.strftime("%F %T")})
        print(f"[{pid}] t2i/{entry['type']} seed={info['seed']}")
        return EXIT_OK

    # i2i:矩阵门先于 ref 解析(拒发理由按根因报)
    need(entry.get("i2iApplicable") is True,
         f"i2i/{entry['type']}: i2iApplicable=false 拒发(该型不走图生图路)")
    need(isinstance(entry.get("i2iInstruction"), str) and entry["i2iInstruction"].strip(),
         f"i2i/{entry['type']}: 指令缺席(status={entry.get('i2iInstructionStatus')});"
         "PENDING-OWNER-WORDING 四型(场景/表情差分/人脸基准/无衣物定妆)待任务真源数组逐字,禁猜措辞拒发")
    ref = resolve_ref(entry, args.ref)
    graph, info = build_i2i(entry, None)
    if args.dry_run:
        dry_report("i2i", entry, graph, info)
        write_state(args.type, ENGINE, {"campaign": CLIENT, "engine": ENGINE, "route": "i2i",
                                        "type": entry["type"], "seed": info["seed"], "prompt_id": None,
                                        "status": "dry", "dry": True, "ref": str(ref),
                                        "inject_canvas": info.get("inject_canvas")}, dry=True)
        print(f"[dry] 未发车(--dry-run 零网络;ref 已解析不上传={ref.name})")
        return EXIT_OK
    preflight()
    ref_name = upload_image(ref, f"gem_t8_matrix_ref_{entry['type']}_{info['seed']}.png")
    graph["10"]["inputs"]["image"] = ref_name
    wait_idle(args.idle_timeout)
    pid = post_prompt(graph)
    write_state(args.type, ENGINE, {"campaign": CLIENT, "engine": ENGINE, "route": "i2i",
                                    "type": entry["type"], "seed": info["seed"], "prompt_id": pid,
                                    "status": "submitted", "submitted_at": time.strftime("%F %T"),
                                    "ref": str(ref.relative_to(REPO)), "ref_engine_name": ref_name,
                                    "inject_canvas": info.get("inject_canvas")})
    print(f"[{pid}] i2i/{entry['type']} seed={info['seed']} ref={ref_name}")
    return EXIT_OK


def cmd_wait(args, matrix: dict) -> int:
    typ = args.type
    st = read_state(typ, args.engine)
    need(typ in matrix, f"矩阵无此型: {typ}")
    entry = matrix[typ]
    route, pid = st.get("route"), st.get("prompt_id")
    if st.get("dry"):
        raise EngineReject(f"{typ}: 状态文件为 dry 态(无真 pid)——真发请先 submit {route} {typ}")
    if not pid or st.get("status") == "done":
        if st.get("status") == "done":
            print(f"[wait] {typ}/{route} 已完成(状态=done),产物在 {OUTROOT / typ / route}")
            return EXIT_OK
        raise EngineReject(f"{typ}: 状态文件无 prompt_id(得 {pid!r})")
    print(f"[wait] {typ}/{route} pid={pid} 轮询 ≤{args.poll_timeout:.0f}s")
    t0 = time.time()
    res = None
    while time.time() - t0 < args.poll_timeout:
        res = fetch_history(pid)
        if res is not None:
            break
        time.sleep(10)
    if res is None:
        print(f"[wait] {args.poll_timeout:.0f}s 未完(pid={pid})→ exit {EXIT_WAITING}(可无限次重入续等)")
        return EXIT_WAITING
    d = OUTROOT / typ / route
    products = download(res["outputs"], d)
    by_node = {p["node"]: p for p in products}
    need("8" in by_node and "504" in by_node,
         f"{typ}/{route}: 双产物缺席(node8={'有' if '8' in by_node else '无'}/"
         f"node504={'有' if '504' in by_node else '无'}),已落盘 {[p['path'] for p in products]}")
    extra = ({"ref": st.get("ref"), "ref_engine_name": st.get("ref_engine_name"),
              "inject_canvas": st.get("inject_canvas")}
             if route == "i2i" else {})
    a = finalize(entry, route, res, st, products, extra)
    st.update({"status": "done", "bare": by_node.get("8"),
               "finished_at": time.strftime("%F %T"), "audit": a})
    write_state(typ, args.engine, st)
    print(f"[wait] {typ}/{route} 完成 audit={a}")
    return EXIT_OK


def cmd_audit(args, matrix: dict) -> int:
    """从盘上 meta/产物/装配文重跑断言(与 wait 内联版同函数同口径)。"""
    typ = args.type
    need(typ in matrix, f"矩阵无此型: {typ}")
    routes = [args.route] if args.route else [r for r in ("t2i", "i2i")
                                              if (OUTROOT / typ / r / "meta.json").is_file()]
    need(routes, f"{typ}: 无 meta.json 可审计(先 submit+wait)")
    worst = False
    for route in routes:
        d = OUTROOT / typ / route
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        products = []
        for p in meta.get("products", []):
            f = REPO / p["path"]
            if f.is_file():
                w, h = png_dims(f)
                products.append({**p, "w": w, "h": h})
        assembled = None
        at = OUTROOT / typ / f"{route}_assembled_prompt.txt"
        if meta.get("assembled_prompt") and at.is_file():
            assembled = at.read_text(encoding="utf-8")
        a = audit(matrix[typ], route, assembled, products,
                  meta.get("inject_canvas"),
                  bool(meta.get("bare") and meta["bare"]["w"] * meta["bare"]["h"] > GEM_CAP_MP * 1e6))
        meta["audit"] = a
        (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        worst |= audit_has_fail(a)
        print(f"[audit] {typ}/{route}: {a}")
    return 1 if worst else EXIT_OK


def cmd_check(matrix: dict) -> int:
    """零网络自证:矩阵 14 型 + 两图件件内现值(换装+4K帽)+ 压幅表预览。"""
    for tag, twin in (("t2i", TWIN_T2I), ("i2i", TWIN_I2I)):
        graph = json.loads(twin.read_text(encoding="utf-8"))["graph"]
        self_check(graph, f"check/{tag}")
        print(f"[check] {tag} 孪生四点自证 PASS(8101 r178/8102 restore@1.0/8104 C句头/8100=8.25)")
    for t, e in matrix.items():
        st = e["i2iInstructionStatus"]
        dims = i2i_compress_dims(t)
        print(f"[check] {t:<8} i2i={'✓' if e['i2iApplicable'] else '—'} 指令={st:<22} i2i压幅={dims}")
        if st == "PENDING-OWNER-WORDING":
            print(f"          └ 待任务真源数组逐字(锚:purpose/special.purpose_anchor),submit i2i 将拒发")
    print("[check] 完成(零网络)")
    return EXIT_OK


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("submit", help="提交即退:submit t2i <型> / submit i2i <型>")
    s.add_argument("route", choices=["t2i", "i2i"])
    s.add_argument("type")
    s.add_argument("--ref", type=Path, default=None, help="i2i 参考图覆写(缺省=t2i 钉死路径)")
    s.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    s.add_argument("--idle-timeout", type=float, default=120, help="队列软门上限(超时照样入队)")
    s.add_argument("--dry-run", action="store_true", help="注入面全构造+断言+状态文件写,不真发零网络")
    s.add_argument("--outroot", type=Path, default=None,
                   help="产物根覆写(缺省 gem-t8-matrix-1118;新役单夹归集用)")
    w = sub.add_parser("wait", help="轮询等完成并下载双产物(未完 exit 7 可重入)")
    w.add_argument("type")
    w.add_argument("engine", help="状态文件引擎段(容忍 URL/host:port/slug,如 192.168.0.101:17000)")
    w.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    w.add_argument("--poll-timeout", type=float, default=510)
    w.add_argument("--outroot", type=Path, default=None)
    a = sub.add_parser("audit", help="从盘上产物重跑断言")
    a.add_argument("type")
    a.add_argument("route", nargs="?", choices=["t2i", "i2i"], default=None)
    a.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    a.add_argument("--outroot", type=Path, default=None)
    c = sub.add_parser("check", help="矩阵+图件自证(零网络)")
    c.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    args = ap.parse_args()
    global OUTROOT
    if getattr(args, "outroot", None) is not None:
        OUTROOT = args.outroot if args.outroot.is_absolute() else REPO / args.outroot
    if args.cmd == "check":
        return cmd_check(load_matrix(args.matrix))
    matrix = load_matrix(args.matrix)
    if args.cmd == "submit":
        return cmd_submit(args, matrix)
    if args.cmd == "wait":
        return cmd_wait(args, matrix)
    return cmd_audit(args, matrix)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refuse as exc:
        print(f"[fire] 拒发: {exc}", file=sys.stderr)
        sys.exit(EXIT_REFUSE)
    except EngineReject as exc:
        print(f"[fire] 引擎面错误: {exc}", file=sys.stderr)
        sys.exit(EXIT_ERROR)
